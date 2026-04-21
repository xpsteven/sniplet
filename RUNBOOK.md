# 營運 Runbook — sniplet.page

本 runbook 涵蓋:
1. Secret 輪換流程
2. Incident response 流程
3. Ops alerts 與對應處理
4. 例行檢查

**對象**:sniplet.page operator(目前為 XP,團隊擴大時延伸)。

**範圍**:v0.8.14。架構變動時同步更新。

---

## 1. Secret 清單

| Env var | 用途 | 洩漏後果 | 輪換複雜度 |
|---|---|---|---|
| `SESSION_JWT_SECRET` | 簽 session cookie JWT(7 天,v0.8.13 從 30 天縮,與 sniplet TTL 對齊) | 攻擊者可偽造 session cookie → 冒充任何 viewer | 中(所有 session 失效) |
| `MAGIC_JWT_SECRET` | 簽 magic link JWT(15 分鐘) | 攻擊者可偽造 magic link → 在 15 分鐘內奪取任何 viewer session | 低(影響範圍短) |
| `EMAIL_HASH_SECRET` | Email 的 HMAC salt;用於 `EMAIL_INDEX_KV` key、`meta.viewers[].h`、JWT `sub`(v0.8.11 F-11) | 拿到 KV / R2 / cookie dump 的攻擊者可透過 rainbow attack 還原 viewer email | 高(dual-compute migration;涉及 index + R2 + sessions 三處,見 §2.4) |
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

**Graceful 變體(低緊迫性輪換)**:Bump JWT payload `v: 1 → v: 2`。Deploy 同時接受 `SESSION_JWT_SECRET_V1` 與 `SESSION_JWT_SECRET_V2` 的版本。7 天後(對齊 session TTL)移除 V1。(需要 code 支援 multi-secret verification — v1 MVP 尚未實作)

### 2.3 `MAGIC_JWT_SECRET` 輪換

**何時**:懷疑外洩。

**影響**:所有未過期的 magic link(最多 15 分鐘 window)失效。剛點連結的 viewer 會在 `/auth/consume` 時 verification 失敗,需要重新請求。

**步驟**:
1. 產生新 secret
2. 透過 `wrangler secret put` 更新
3. 立即 deploy(影響範圍小 — 最壞情況是使用者重新申請)
4. 不需協調;15 分鐘自然過期完成輪換

### 2.4 `EMAIL_HASH_SECRET` 輪換(v0.8.11 後影響面擴大)

**何時**:懷疑 KV / R2 dump 外洩,或發現嚴重 cryptographic 問題。

**影響(v0.8.11 F-11 升 v1 後)**:
- `EMAIL_INDEX_KV` 所有 entry 失效(key 變了)
- `meta.viewers[].h` 失效(HMAC 變了)— 所有私享 sniplet 的白名單 HMAC 需 rebuild
- **所有 session cookie 失效**:JWT `sub` 是舊 HMAC,輪換後對不上新 `meta.viewers[].h`,下次 GET 即回 challenge page
- 合法 viewer 需重新走 magic link 取得新 session

**不走 dual-write 的嚴重性**:R2 中 viewer 白名單實質斷鏈,所有私享 sniplet 白名單變空 → 合法 viewer 永遠 miss;`/auth/request` 也 miss → 永遠收不到 magic link。**必須 dual-write 或 backfill**,否則等於全體私享功能停擺直到 sniplet 過期。

**步驟(dual-write migration,avoid 全站 downtime)**:

1. 產生新 secret,暫存為 `EMAIL_HASH_SECRET_NEW`(**不**取代舊值)
2. 部署 code 改動(dual-compute):
   - 寫入路徑(POST / PATCH viewers):同時用 old 與 new secret 計算 HMAC,`meta.viewers[]` 暫時變成 `{ h_old, h_new, m }`;`EMAIL_INDEX_KV` 同時寫兩個 key
   - 讀取路徑(`/auth/request`):先查 new_key,miss 則 fallback old_key
   - 授權比對(GET 私享):session cookie `sub` 可能是 old 或 new;同時與 `h_old` 和 `h_new` 比對,任一命中即放行
   - 簽 JWT(新發 session):用 new secret,`sub` = new HMAC
3. 撰寫 migration script,對 R2 中每個 active sniplet:
   ```ts
   // 讀取 meta.viewers(含 h_old + m,注意:v0.8.11 起明文 email 已不存於 R2)
   // 用新 secret 計算新 HMAC 填 h_new
   // 寫回 meta.json
   // 同時把對應 EMAIL_INDEX_KV entry 加 new key
   ```
   **關鍵限制**:v0.8.11 後 `meta.viewers` 不再含明文 email — script 無法從 R2 還原明文。解法:這份 secret 本就有 deterministic 性質,從 `h_old` 再算不出 `h_new`(HMAC 單向)。因此 backfill **需要明文 email source**;可行來源:
     - (a) PATCH / POST 時 creator 送明文 → 在 dual-compute window 內自然 catch up(不處理舊 sniplet)
     - (b) 暫不處理既有 sniplet,等它們 7 天內自然過期;新 sniplet 才用新 secret
     - **建議預設選 (b)**,唯一成本是「輪換前建立的私享 sniplet 在輪換期間無法 auth」,但新 sniplet 正常運作
4. 監控 `auth_request_received` 的 `was_on_whitelist=true` rate;若選 (b),該 rate 會先降後恢復
5. 7 天後(或 migration 完成後):切換 `EMAIL_HASH_SECRET` 指向新 secret、移除 `EMAIL_HASH_SECRET_NEW` 與 dual-compute code
6. Deploy;舊 `h_old` 條目隨 sniplet TTL 7 天自然過期

**若急迫(接受 downtime)**:
1. 產生新 secret + 更新 env + deploy
2. 不做 backfill;所有既有私享 sniplet 白名單斷鏈 7 天
3. 合法 viewer 重新被 creator 用明文 PATCH add 進白名單(代價明顯)
4. 選擇低流量時段執行,並事前 email 通知 creator

**v2 評估**:若要避免 (b) 的斷鏈 7 天,v2 可評估:(i) 讓 creator 在 dashboard 重匯明文 viewer list;(ii) 用第二組獨立 secret `SUB_HASH_SECRET` 專給 JWT,使 `EMAIL_HASH_SECRET` 輪換只影響 index 不影響 sessions(解耦,但多一個 secret)。

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
   - 公開:更新 `sniplet.page/security#advisories` 段落(operator 手動 edit Worker assets;v0.8.13 起為唯一公開 channel,GitHub repo 為 private)
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
5. 超過 15 分鐘則透過 **`sniplet.page/security#advisories` 段落**對外溝通(v0.8.13 從 GitHub README 改;status page 列 v2 roadmap,v1 不做)

### 3.4 SEV-3 劇本:個別 viewer 回報 session cookie 外洩(v0.8.11 F-29)

**情境**:Alice 透過 `security@sniplet.page` 回報,懷疑自己裝置 / 瀏覽器 cookie 被偷(laptop 失竊、malware、借人未登出、瀏覽器備份外流等)。

**嚴重度評估**:LOW。攻擊者拿 Alice 的 cookie 能做的是瀏覽 Alice 白名單內的私享 sniplet(read-only);**無法** 新建 / 刪除 / PATCH 任何 sniplet(那些需要 `owner_token`,不在 cookie 裡)。

**回覆 Alice 的流程**:

1. **確認嚴重度**:問 Alice 是否為單純 cookie 疑慮,還是懷疑更廣泛的身份外洩(若後者,升 SEV-2,並考慮走 §2.2 `SESSION_JWT_SECRET` 輪換 nuclear 選項)
2. **指引 Alice 自助**:
   - 在**當前裝置**的 browser 打 `POST sniplet.page/auth/logout`(或清 cookies)只會清她手上的 cookie,**不影響** 被偷裝置上的 cookie
   - 告知 v1 無 per-user revocation:被偷的 cookie 最多 valid 7 天(v0.8.13 從 30 天縮,與 sniplet TTL 對齊),到期自然失效
   - 告知攻擊者能看的範圍(僅 Alice 白名單內的私享 sniplet,read-only),幫助評估真實傷害
3. **決定 operator 側動作**:
   - 若 Alice 白名單內的 sniplet 含**高敏感內容**(公司內部資料、法律文件等),**建議**(但不強制)creator PATCH 暫時把 Alice 從 viewers 移除,或 DELETE 該 sniplet;無須走 nuclear 輪換
   - 若擔心同批攻擊影響多個 viewer(例如公司整批裝置被 compromise),考慮 §2.2 `SESSION_JWT_SECRET` 輪換(全體登出,合法 viewer 需重新收 magic link)
4. **記錄**:純文字 log 檔紀錄:回報時間、Alice 受影響裝置描述(不記 cookie 內容)、採取的動作、結果;保留 1 年

**為何 v1 這樣設計**:per-user revocation(JWT revoke list)需要每次 GET 多一次 KV read,v1 為成本 / 複雜度 trade-off 不做。此 F-29 接受 **7 天**(v0.8.13 從 30 天縮)cookie 外洩 window 為 LOW 嚴重度下的合理成本;v2 若客訴 / 實際事件顯示 LOW 評估不對,再做 revoke list。

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
| `auth_global_cap_hit` 當日首次觸發 | 全站 `/auth/request` Resend send cap 達到(F-32) | SEV-3 | 判斷:(a) 合法成長 → 升 Resend tier 並同步 bump Worker 中的 `AUTH_SEND_DAILY_CAP` 常數 deploy;(b) 攻擊 → CF firewall rule 暫擋可疑 IP / ASN,觀察流量回落再放行;當日已觸發 → 現有合法 viewer 收不到 magic link 直到 UTC 隔日 00:00 或 cap bump |
| `sniplet_404_miss` 單 ip_hash > 200/hour(F-42,v0.8.15) | 可能 slug enumeration 攻擊 | SEV-3 | 分析該 ip_hash 的 query pattern(分散隨機 slug? 集中特定品牌 slug 前綴?);若為攻擊 → CF firewall rule 針對該 ASN / country 加掃描阻擋;合法 browser prefetch / 爬蟲 → 接受,觀察再決定是否 tune 閾值 |
| `sniplet_mutated` 非預期 spike(F-41,v0.8.15) | owner_token 可能洩漏 + 攻擊者批量 PATCH / DELETE | SEV-2 | 緊急聯絡 creator(若可識別);審核近 24 小時 `sniplet_mutated` 的 slug_hash 清單;考慮全站 session 輪換(RUNBOOK §2.2)若懷疑 token 批量外洩 |
| `csp_report_rate_limited` 單 ip_hash > 50/hour(F-40,v0.8.15) | CSP report endpoint 被 flood | SEV-3 | CF firewall rule 針對該 IP / ASN 短期 block;確認 Analytics Engine 用量未超配額 |

---

## 5. 例行檢查

### 每週
- Review Analytics Engine dashboard 有無異常
- 檢查 `resend_send_failed` 總量(應 < 1% 的寄送數)
- 檢查 R2 儲存量趨勢(突發 spike 代表 cron 掛掉?還是爆紅?)
- 檢查 `csp_violation` trend

### 每月
- **不做 scheduled secret 輪換**(輪換為 event-driven,不是時間驅動)
- Review `security@sniplet.page` inbox 是否有新回報(對照 `/security` page 的 disclosure timeline)
- 檢查 cost dashboard 對照 PRD §15 scenarios

### 每季
- 完整安全 self-audit:走一遍 PRD §11 的 checklist
- Review `RUNBOOK.md` 是否過時;架構變動則更新
- 檢查 `/.well-known/security.txt` 的 `Expires` 是否領先 ≥ 1 年,不足則更新並重新 deploy

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
- [ ] Resend 帳號 active,`sniplet.page` 寄件網域已驗證(**DKIM + SPF + DMARC**,F-39 v0.8.14 加)
  - DMARC DNS record:`_dmarc.sniplet.page TXT "v=DMARC1; p=reject; rua=mailto:security@sniplet.page; adkim=s; aspf=s"`
  - `p=reject` 讓其他 MTA 拒收偽造 sniplet.page 的信(防 magic link phishing 互仿),`adkim=s` + `aspf=s` 嚴格 alignment
  - 若剛啟用時擔心合法信被誤判,可先用 `p=quarantine` 觀察 `rua` 報表 7 天再升 `p=reject`
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
- [ ] `RUNBOOK.md`(本檔)已 push 到 ops repo(不公開)
- [ ] `/security` page(§10.7)live,內容 review 過
- [ ] `/.well-known/security.txt`(§10.8)live,`Expires` 設為實際 ship 日起算 ≥ 1 年
- [ ] `/security` page 含 `#advisories` 空段落(SEV 事件公告唯一公開 channel;v0.8.13 起取代原 GitHub README 段落)
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

## 9. Cloudflare account 與 Wrangler security(v0.8.15 新增,M-4)

所有 sniplet.page 資料、secret、deploy 權限都掛在單一 Cloudflare account。**這個帳號被接管 = 全盤 compromise**,且 attacker 可直接 edit Worker code 讓所有防線失效。因此 CF account 的 hygiene 是最上游的安全邊界。

### 9.1 Account 層 hardening

- **強制 2FA**:必須用 hardware key(YubiKey / Titan)或 TOTP(Google Authenticator / 1Password);**不用 SMS**(SIM swap 攻擊)
- **Recovery code 離線保存**:CF 產生的 recovery code 印出來放保險箱,或存密碼管理器獨立 vault(不與日常 password vault 同)
- **Login email**:使用專屬 email(非 `xpsteven@gmail.com` 之類日常帳號)以降低 credential stuffing 機率;此 email 本身也需 2FA + 獨立密碼
- **Admin session 定期登出**:CF Dashboard 登入後完成工作即登出,不留 idle session
- **Login notification**:啟用 CF 的「新裝置登入提醒」email 通知

### 9.2 API Token scope minimization

部署與 ops 用的 `CF_API_TOKEN` **MUST** 遵循 least privilege:

- **不要用 Global API Key**(等同完整帳號密碼)
- 每個用途建一個**獨立 token**,各自限制 scope:

| 用途 | 所需 permission | 建議 TTL |
|---|---|---|
| Worker deploy(wrangler CI) | Account: Workers Scripts:Edit + Account: Workers R2 Storage:Edit + Account: Workers KV Storage:Edit + Account: Account Analytics:Read | 90 天,週期性輪換 |
| Read-only monitoring / 讀 Analytics | Account Analytics:Read + Workers Scripts:Read | 無期限(風險低) |
| DNS 設定 | Zone:DNS:Edit(僅 sniplet.page zone) | 完成後刪除 |

- **IP restrictions**:若有固定 IP 出口,限制 token 只能從該 IP 使用(CF token 支援 IP allowlist)
- **Token 洩漏處置**:CF Dashboard → API Tokens → 立即 Delete;產新 token 存 `CF_API_TOKEN` 環境變數或 `.env`;`git log -p` 檢查是否誤 commit 過(若有,走 `git filter-repo` 或 rewrite 歷史)

### 9.3 Wrangler 本機 hygiene

- **不把 secret 寫進 `wrangler.toml`**:secrets 只用 `wrangler secret put <NAME>`,`wrangler.toml` 只放 `vars`(非敏感 env var)
- **`.env` 或 `.dev.vars` MUST 在 `.gitignore`**:local dev secrets(`RESEND_API_KEY_DEV` 等)不得 commit
- **`wrangler tail` 勿在 production 長期掛載**:會 stream 生產流量的 request header 到本機 terminal,若 terminal 歷史 log 被抓取 = 等於 edge log 外洩;debug 完即停止
- **`wrangler dev` 的 remote mode**:會跑在 CF edge 且能看到真實 env secret,不要在公共 wifi / 共用電腦執行
- **CI deployment**:用 GitHub Actions secret 存 `CF_API_TOKEN`;不要在 CI log 中 echo 此值;token 設 deploy-only scope

### 9.4 Account 接管的偵測與復原

**偵測訊號**:
- 非預期時間的 CF login notification email(半夜、國外 IP 登入)
- Cron trigger / Worker route 被修改(operator 自己沒動)
- R2 / KV 有非預期刪除
- Resend 帳號收到 API key 輪換通知(若 attacker 覆蓋)
- Worker deploy 歷史出現未知 deployment(CF Dashboard → Workers → Deployments)

**復原步驟**(一旦懷疑帳號被接管):
1. **立即**:從可信裝置登入 CF → 強制所有 session 登出(Account → Audit Log → Revoke all active sessions)→ 改密碼 + 重設 2FA
2. **全部 API token revoke**:即使沒被明顯用到,全部刪掉重發
3. **檢查 Worker code diff**:`wrangler deployments list` 比對預期版本;若有 unauthorized deploy,rollback
4. **輪換所有 secret**(走 §2 流程):`SESSION_JWT_SECRET`、`MAGIC_JWT_SECRET`、`EMAIL_HASH_SECRET`、`IP_HASH_SECRET`、`RESEND_API_KEY`、`TURNSTILE_SECRET`
5. **檢查 DNS record**:尤其 MX / DMARC / CAA 有沒有被改
6. **SEV-1 incident response**(§3.2):72 小時內通報受影響使用者,`sniplet.page/security#advisories` 段落公告

**預防 > 復原**:此節目的是讓 operator 意識到 CF account 本身是 attack surface,不是只有 application code。

---

*最後更新:2026-04-22(v0.8.15)*
