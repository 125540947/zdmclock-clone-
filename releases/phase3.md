# Phase 3 · 核心子集 #185~#190（时区 / 资产 / health / 输入上限 / 限流器 LRU / token HttpOnly）

> Tag: `phase3` → commit `c63752b` ｜ 2026-08-13

## 改动要点
外部审计复核后的中风险收尾：时区统一、资产账本字段语义、health 并发、零依赖输入上限、限流器 LRU、Token HttpOnly。刻意跳过 CI/ESLint、dev 依赖升级、构建可复现（用户选范围外）。

## 新增功能 / 问题修复
- **#185 时区**：`startup.js` 用 `zonedWallClock(config.tz)`；新增 `startup.tz.test.js`。
- **#186 assetLedger 字段修正**：`snap.exp` 存储（修 `expAfter` 误写致 exp 累计恒 0）；`assetLedger.test.js` 增补。
- **#187 health**：`probeHealth` 支持命名 check（`{name,fn}`）+ `AbortSignal.timeout` 截止，超时填 `{name,ok:false,degraded:true}` 保名归属；`index.js` 补 `import { load }` 修复 `/api/health` 调 `load()` 未定义崩溃；慢依赖标 `degraded` 不致命。`health.test.js` 重写。
- **#188 输入上限（零依赖 validation.js，不引 zod）**：`InputError`/`limitStr`/`requireStr`/`limitArr`/`boundedInt` + 常量（MAX_COOKIE_LEN=16384 / MAX_IMPORT_ITEMS=500 / MAX_NAME_LEN=128）；接入 tasks(name 钳) 与 admin(risk 数值钳)；新增 `validation.test.js`(9)。
- **#189 限流器 LRU**：`middleware/rateLimit.js` 加 `maxEntries`(5000) 硬淘汰，防 IPv6 撑爆 Map；`rateLimit.test.js` 补 2。
- **#190 token HttpOnly（零依赖）**：`auth.js` 自实现 `parseCookies`；`routes/auth.js` 用 express 原生 `res.cookie` 下发 `httpOnly+sameSite:lax` 的 `zb_token`/`zb_admin_token`，新增 `POST /auth/logout`、`/config` 下发 `loggedIn/isAdmin`；前端 `client.js` 开 `withCredentials`、删 localStorage 明文 token、新增 `session.js` 响应式状态；App/router/AdminLayout 改用 session。**前端已 build 并提交 dist**。authRoute 新增 2 cookie 测试。

## 测试与部署
- 后端测试 **401/401** 全绿（含 +12 新测）。
- 部署：`deploy-smart-startup.sh` 更新至 SHA `c63752b`，fetch 清单补 `health.js` / `validation.js` / `middleware/rateLimit.js` / `routes/baoliao.js`，前端 dist 新 hash（index-BV0YXSN5.js / index-D9byJjRX.css）。

## 关联
- 前置：Phase 1（f86a0c9）、Phase 2（63f75a0）。
- 历史全量分批见仓库根 `CHANGELOG.md`（6 批次）。
