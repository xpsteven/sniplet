# 營運 Runbook — sniplet.page

本 runbook 涵蓋:
1. Secret 輪換流程
2. Incident response 流程
3. Ops alerts 與對應處理
4. 例行檢查

**對象**:sniplet.page operator(目前為 XP,團隊擴大時延伸)。

**範圍**:v0.8.10。架構變動時同步更新。

---

## 1. Secret 清單

| Env var | 用途 | 洩漏後果 | 輪換複雜度 |
|---|---|---|---|
| `SESSION_JWT_SECRET` | 簽 session cookie JWT(30 天) | 攻擊者可偽造 session cookie → 冒充任何 viewer | 中(所有 session 失效) |
| `MAGIC_JWT_SECRET` | 簽 magic link JWT(15 分鐘) | 攻擊者可偽造 magic link → 在 15 分鐘內奪取任何 viewer session | 低(影響範圍短) |
| `EMAIL_HASH_SECRET` | Email 索引 KV 的 HMAC salt | 拿到 KV dump 的攻擊者可透過 rainbow attack 還原 viewer email | 高(需 dual-write 期間 migration) |
| `IP_HASH_SECRET` | IP hashing 的 HMAC salt | 拿到 KV/R2 dump 的攻擊者可還原 creator IP | 高(既有 hashes 無法輪換,接受 abuse trace 斷鏈) |
| `RESEND_API_KEY` | 透過 Resend 寄 magic link email | 攻擊者可以 sniplet.page 名義寄信;phishing 風險 | 低(Resend dashboard 輪換) |
| `TURNSTILE_SECRET` | 驗證 Turnstile token | 攻擊者可偽造 captcha 通過 → 濫發 magic link 申請 | 低(CF dashboard 輪換) |

---

## 2. Secret 輪換流程

### 2.1 產生新 secret

**Random secrets**(`SESSION_JWT_SECRET`、`MAGIC_JWT_SECRET`、`EMAIL_HASH_SECRET`、`IP_HASH_SECRET`)用 32 bytes 隨機 entropy,base64 編碼:

```bash
openssl rand -base64 32
```

**Vendor-issued secrets**(`RESEND_API_KEY`、`TURNSTILE_SECRET`)從各自的廠商 dashboard 取得 — 見下方 §2.6 與 §2.7。

### 2.2 `SESSION_JWT_SECRET` 輪換

**何時**:懷疑外洩、JWT library 有 CVE、或 event-driven 需求(**不做 scheduled rotation**;policy 見 §5)。

**影響**:所有 active session 立即失效。Viewer 下次存取時需要重新透過 magic link 驗證。

**步驟**:
1. 產生新 secret
2. 用 `wrangler secret put SESSION_JWT_SECRET` 更新 Worker env
3. Deploy
4. 監控 `auth_verified` event rate — 預期會有一波新的 magic link 申請
5. 事後:檢查輪換前一週的 log,看是否有偽造 session 使用跡象

**Graceful 變體(低緊迫性輪換)**:Bump JWT payload `v: 1 → v: 2`。Deploy 同時接受 `SESSION_JWT_SECRET_V1` 與 `SESSION_JWT_SECRET_V2` 的版本。30 天後移除 V1。(需要 code 支援 multi-secret verification — v1 MVP 尚未實作)

### 2.3 `MAGIC_JWT_SECRET` 輪換

**何時**:懷疑外洩。

**影響**:所有未過期的 magic link(最多 15 分鐘 window)失效。剛點連結的 viewer 會在 `/auth/consume` 時 verification 失敗,需要重新請求。

**步驟**:
1. 產生新 secret
2. 透過 `wrangler secret put` 更新
3. 立即 deploy(影響範圍小 — 最壞情況是使用者重新申請)
4. 不需協調;15 分鐘自然過期完成輪換

### 2.4 `EMAIL_HASH_SECRET` 輪換(dual-write migration)

**何時**:懷疑 KV dump 外洩,或發現嚴重 cryptographic 問題。

**影響**:若不走 dual-write,所有 `EMAIL_INDEX_KV` 條目失效 → 合法 viewer 的 `/auth/request` 會 miss index 並 silently skip(Strategy C)→ 收不到 magic link。

**步驟(dual-write migration,避免 downtime)**:

1. 產生新 secret,暫存為 `EMAIL_HASH_SECRET_NEW`
2. 部署 code 改動:
   - 寫入路徑(POST / PATCH viewers):同時寫入 old_key 與 new_key
   - 讀取路徑(`/auth/request`):先查 new_key,miss 則 fallback old_key
3. 撰寫 migration script,對 R2 中每個 active sniplet:
   ```ts
   //   讀取 meta.viewers(v0.8.10 為明文 email)
   //   對每個 email 用新 secret 計算新 HMAC
   //   用新 key 寫入 EMAIL_INDEX_KV
   ```
4. 監控 `auth_request_received` 的 `was_on_whitelist=true` rate 恢復到輪換前水準(24 小時內)
5. 切換:`EMAIL_HASH_SECRET` 指向新 secret、拔掉 `EMAIL_HASH_SECRET_NEW` + dual-write code
6. Deploy;舊 old_key 條目隨 TTL 7 天自然過期

**若急迫(接受 downtime)**:
1. 產生新 secret + 更新 env + deploy
2. 跑 backfill script
3. 期間 `/auth/request` miss 所有舊 sniplet(預期 5–30 分鐘,取決於 R2 scan 速度)
4. 選擇低流量時段執行

**v2 改善**:若 `meta.viewers` 改為儲存 hashes(F-11 roadmap),此 migration 會變得更複雜,需要 email 明文短暫保留或走多階段 migration。

### 2.5 `IP_HASH_SECRET` 輪換

**何時**:懷疑外洩。

**影響**:
- `meta.json` 中的 `ip_hash` 與新 `ip_quota:*` KV hash 無法 correlate → abuse 調查斷鏈(輪換前 7 天內的 sniplet)
- `ip_quota:*` counter 等同 reset,攻擊者獲得免費配額

**步驟**:
1. 產生新 secret
2. **先暫停進行中的 abuse 調查**(若有):輪換前把可疑 IP 對應的 hash + 案件細節抄出來 pin 在案件 log,否則輪換後無法再 correlate
3. 更新 env
4. Deploy
5. 接受 7 天 blind window(所有輪換前 `meta.json` 條目透過 TTL 過期)
6. `ip_quota:*` keys 有 26 小時 TTL,自行 reset

**備註**:這是罕見事件。實務上,把 secret 保管好比輪換它重要。

### 2.6 `RESEND_API_KEY` 輪換

**步驟**:
1. 在 Resend dashboard:產生新 API key
2. 透過 `wrangler secret put RESEND_API_KEY` 更新 Worker env
3. Deploy
4. 在 Resend dashboard 撤銷舊 key
5. 監控 `resend_send_failed` event rate 有無 misconfiguration

### 2.7 `TURNSTILE_SECRET` 輪換

**步驟**:
1. 在 Cloudflare dashboard → Turnstile:輪換 key
2. 更新 Worker env(若 site key 也變了一起更新)
3. Deploy
4. 若 site key 變了,同步更新 challenge page HTML

---

## 3. Incident Response

### 3.1 Severity 等級

- **SEV-1**:資料外洩、authentication bypass、secret 外洩、`owner_token` 透過 CF edge log 外洩
- **SEV-2**:服務降級(Resend 掛點、error rate 過高)
- **SEV-3**:小 bug、UX 問題、monitoring alert

### 3.2 SEV-1 流程(資料外洩)

1. **Contain**(1 小時內):
   - 若 secret 外洩 → 立即輪換(見 §2)
   - 若 auth bypass → push hotfix 阻斷攻擊向量
   - 若資料被 exfiltrate → 確認受影響的 sniplets / viewers
2. **Assess**(24 小時內):
   - 哪些資料曝光?(Sniplet 內容?Viewer email?Creator IP?)
   - Scope:多少使用者受影響?
   - 時間線:何時開始?
3. **Notify**(72 小時內,依 GDPR Art 33):
   - 主管機關:對應的 data protection authority(如台灣 PDPA;若有 EU 使用者則 EU DPA)
   - 使用者:若可識別 email 則 email 通知受影響的 viewer / creator
   - 公開:更新 GitHub repo `README.md` 的 "Known Issues / Advisories" 段落 與 `SECURITY.md` 的 advisory log
4. **Remediate**:
   - 修正 root cause
   - 加 regression test
   - 加 monitoring 偵測類似問題
5. **Post-mortem**(2 週內):
   - Blameless 撰寫
   - 發佈(redacted)到 GitHub repo

### 3.3 SEV-2 流程(服務降級)

1. 回應 alert
2. 檢查元件狀態(Cloudflare、Resend、Turnstile status page)
3. 若是第三方:等待或切換(若有 fallback — Resend 目前無 fallback,接受單點)
4. 若是內部:rollback 或 hotfix
5. 超過 15 分鐘則透過 **GitHub repo `README.md` Known Issues 段落** 對外溝通(status page 列 v2 roadmap,v1 不做)

---

## 4. Monitoring Alerts

所有 alerts 以 Analytics Engine events 為依據(PRD §7.17)。CF Dashboard → Analytics Engine → SQL API → 設定 Notifications。

| Alert | 觸發條件 | Severity | 處理 |
|---|---|---|---|
| `resend_send_failed` rate > 5% in 5 min | Resend API 失敗 | SEV-2 | 檢查 Resend status;檢查 API key;檢查 DKIM;若持續則更新 GitHub README 通知 |
| 24 小時內無 `cron_cleanup_success` event | Cron Worker 沒跑 | SEV-3 | 檢查 CF Dashboard → Workers → Cron Triggers;手動觸發 cleanup;調查 scheduled run 失敗原因 |
| `daily_cap_hit` event | 單日 1000 sniplet cap 達到 | SEV-3 | 成長期正常;若突發 spike 則檢查濫用。考慮提升 cap |
| `rate_limit_hit` 的 per-IP / per-email reason spike | 單 IP 或單 email 狂打 | SEV-3 | 檢查是合法 burst 還是攻擊。CF firewall rule 可直接 block |
| `csp_violation` event rate > 100 / day | CSP 攔下 HTML 行為高 | SEV-3 | 檢查是新 CDN 要加清單 / legit 用例,還是 abuse 訊號 |

---

## 5. 例行檢查

### 每週
- Review Analytics Engine dashboard 有無異常
- 檢查 `resend_send_failed` 總量(應 < 1% 的寄送數)
- 檢查 R2 儲存量趨勢(突發 spike 代表 cron 掛掉?還是爆紅?)
- 檢查 `csp_violation` trend

### 每月
- **不做 scheduled secret 輪換**(輪換為 event-driven,不是時間驅動)
- Review `SECURITY.md` 是否有收到新回報
- 檢查 cost dashboard 對照 PRD §15 scenarios

### 每季
- 完整安全 self-audit:走一遍 PRD §11 的 checklist
- Review `RUNBOOK.md` 是否過時;架構變動則更新

---

## 6. 緊急聯絡

- **Primary operator**:XP(`security@sniplet.page`)
- **Cloudflare support**:透過 dashboard,Enterprise plan 尚未啟用(SEV-1 時 CF 響應時間有限)
- **Resend support**:`support@resend.com`
- **Domain registrar**:(TBD — 購買 `.page` 時設定)

---

## 7. 附錄:首次 setup checklist

(對應 PRD §17 0–1hr,以 ops 角度展開)

- [ ] Cloudflare 帳號 active 且已設付款方式
- [ ] `sniplet.page` 已註冊,DNS 指向 CF
- [ ] DNSSEC 啟用(CF dashboard 一鍵)
- [ ] **Wildcard DNS record 設定**:`*.sniplet.page A/AAAA` 指向 Workers,一筆通吃所有 sniplet subdomain
- [ ] **Wildcard SSL cert**:CF Universal SSL 自動 provision 一張 `*.sniplet.page` 憑證(免費,cover 一層 wildcard)
- [ ] CAA records 設定:
  ```
  sniplet.page. CAA 0 issue "letsencrypt.org"
  sniplet.page. CAA 0 issue "pki.goog"
  sniplet.page. CAA 0 iodef "mailto:security@sniplet.page"
  ```
- [ ] **CF Log Push 未啟用**,或若啟用則確認 `Authorization` header 在 drop list(避免 owner_token 入 log pipeline)
- [ ] Resend 帳號 active,`sniplet.page` 寄件網域已驗證(DKIM + SPF)
- [ ] Cloudflare Turnstile site 已建立,site key + secret 已取得
- [ ] 4 個 random secrets 透過 `openssl rand -base64 32` 產生並存入 Worker env:
  - [ ] `SESSION_JWT_SECRET`
  - [ ] `MAGIC_JWT_SECRET`
  - [ ] `EMAIL_HASH_SECRET`
  - [ ] `IP_HASH_SECRET`
- [ ] 2 個 vendor-issued secrets 從各自 dashboard 取得並存入 Worker env:
  - [ ] `RESEND_API_KEY`(從 Resend dashboard,DKIM 驗證後)
  - [ ] `TURNSTILE_SECRET`(從 Cloudflare Turnstile dashboard,site 建立後)
- [ ] Bot Fight Mode 在 CF dashboard 啟用
- [ ] R2 bucket `SNIPLETS` 已建立,access 僅限 Worker
- [ ] KV namespaces 已建立:`METER_KV`、`EMAIL_INDEX_KV`、`MAGIC_CONSUMED_KV`
- [ ] Analytics Engine dataset `ANALYTICS` 已建立
- [ ] Cron Triggers 設定:`0 2 * * *`
- [ ] Monitoring alerts(§4 上方)已設定
- [ ] `SECURITY.md` 與 `RUNBOOK.md`(本檔)已 push 到 repo
- [ ] `README.md` 有 "Known Issues / Advisories" 空段落(供 SEV 事件使用)
- [ ] `security@sniplet.page` mailbox active 且有人監控

---

## 8. Emergency content takedown

收到「某 sniplet 是 phishing / malware / 侵權 / 法律強制下架」通報,但無法取得 `owner_token`(通報人不是 creator)時,operator 需直接下架。v1 沒有 admin endpoint,走 wrangler + CF Dashboard 手動流程:

**步驟**:

1. **確認**:比對通報內容與 sniplet 實際 HTML(若是法律通報,保留通報信與依據)
2. **刪 R2 物件**(sniplet 內容 + metadata):
   ```bash
   wrangler r2 object delete SNIPLETS/sniplets/{slug}/index.html
   wrangler r2 object delete SNIPLETS/sniplets/{slug}/meta.json
   ```
3. **確認無 edge cache 殘留**:v0.8.10 已移除 edge cache,此步驟不需要操作。若未來加回 cache,此處需加 purge 步驟。
4. **清 email index**(若為私享 sniplet):
   - v1 限制:找出對應 HMAC KV key 需人工或 admin script(TODO v2)
   - 實務上 sniplet 7 天內自然過期,index 也隨之 orphan,攻擊面有限;但若 slug 為敏感内容,應在此步驟人工處理
5. **記錄**:純文字 log 檔(本機保存),紀錄:通報源(email / 聯絡窗口)、slug 的 SHA-256 hash(不存明文 slug)、下架時間、依據;法律相關保留至少 3 年
6. **回覆通報人**:通知已下架、處理時間、聯絡窗口

**注意事項**:
- 此流程**不走** `owner_token` 驗證,僅限 operator 人工執行
- 若是 creator 本人想刪(有 owner_token)→ 走 `DELETE /v1/sniplets/:slug`,不需要本流程
- 若是 DMCA / GDPR 等法律通知 → 保留通報依據至少 3 年(訴訟保存)
- v2 roadmap 做 admin-purge endpoint(有 audit log + 2FA),不走純 wrangler 流程

---

*最後更新:2026-04-18(v0.8.10)*
