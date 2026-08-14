# 审计报告对账：POST_FIX 报告（d0c2df0）vs 当前 HEAD（e002c0e）

> 目的：消除 `POST_FIX_AUDIT_REPORT_2026-08-14.md`「25 项全部开放」结论与任务 tracker「全部 completed」之间的冲突。

## 基线
- POST_FIX 报告审计基线：`d0c2df0`（批次 12）。
- 当前 HEAD：`e002c0e` = `75ca13a`（批次 13）+ `b627123`（前端 UI overhaul）+ `e002c0e`（审计/QA 文档）。
- 自 `75ca13a` 起**后端源码无任何变更**；新增提交仅含前端 UI 与文档。
- 结论：报告所列 25 项在**当前 HEAD 代码层面均已具备修复**——23 项已闭环，L-01/L-02 为刻意保留的设计权衡。该报告是基于 `d0c2df0` 的修复前/部分修复状态快照，其「25 项全开放」结论已**过时**，不能作为当前代码状态依据。

## 逐项目对账

| 项 | 报告结论(d0c2df0) | 当前 HEAD | 证据 |
| --- | --- | --- | --- |
| H-01 | 开放 | 已闭环 | `index.js:142` trustProxy 仅信受信代理网段；`rateLimit.js:20` 限流键用套接字对端 `req.ip`；`auth.js:109-117` getClientIp 仅 trustProxy 时取 XFF |
| H-02 | 开放 | 已闭环(安全默认) | `config.js:105/109` hostAllowlist；`users.js:242/261` untrusted_host 拒绝。未设 PUBLIC_BASE_URL 且 HOST_ALLOWLIST 为空时失败关闭（安全）；建议标准部署显式设 PUBLIC_BASE_URL 以启用脚本生成 |
| H-03 | 开放 | 已闭环 | `dnsGuard.js:33-51` 补齐 100.64/10、192.0.0.0/24、198.18.0.0/15、fe80::/10、ff00::/8。残留：resolve→fetch 竞态窗口（理论，被 redirect:manual + isSafeSmzdmUrl 次序缓解），低风险 |
| H-04 | 开放 | 已闭环 | 根+web `package-lock.json` nanoid 3.3.18；应用未直接调用零长度生成器 |
| M-01 | 开放 | 已闭环 | `health.js:36-39` HTTP 401 归类真实失效（degraded:false，置 cookieExpired） |
| M-02 | 开放 | 已闭环 | 8 个 route 文件均 import `wrapAsync`，约 28 处 handler 包裹 |
| M-03 | 开放 | 已闭环 | `startup.js:28-38` 原子区单飞（startupRunPromise 复用进行中结果） |
| M-04 | 开放 | 已闭环 | 各写路由在 `withWriteLock` 内改内存 + `persistAwait` 一次性应用 |
| M-05 | 开放 | 已闭环 | 各写路由 `await persistAwait()` 真实落盘后才返回成功 |
| M-06 | 开放 | 已闭环 | `health.js:54-67` `mapWithConcurrency` 限制单轮在途 worker 数 |
| M-07 | 开放 | 已闭环 | `notifier.js:71-90` `readBodyCapped` 流式限流，超限即抛 `BodyTooLargeError`（不再整段缓冲） |
| M-08 | 开放 | 已闭环 | `assetLedger.js:226-233` 以窗口前最后快照作为期初余额 |
| M-09 | 开放 | 已闭环 | `ZDM_TZ` 统一驱动 scheduler/taskRunner/startup/assetLedger/clock 的「今天」折算（同族 todayStrTZ/yesterdayStrTZ） |
| M-10 | 开放 | 已闭环 | `users.js:45-68` 移除遗留账号全可见特例，无 recordedIp 对匿名不可见 |
| M-11 | 开放 | 已闭环 | `deploy.sh` 按 lock/源/vite 配置变更判定依赖与前端重建（非仅凭文件存在） |
| M-12 | 开放 | 已闭环 | `deploy.sh` 迁移 TRUST_PROXY/COOKIE_SECURE/ZDM_TZ/PUBLIC_BASE_URL 等新字段；certbot 失败降级为警告仍继续 |
| M-13 | 开放 | 已闭环 | `selfUpdate.js:175-186` 依赖/构建失败回滚 `git reset --hard <pre-pull>` |
| M-14 | 开放 | 已闭环 | `scheduler.js:97-99` dom 与 dow 同时受限时取 OR（POSIX 语义） |
| M-15 | 开放 | 已闭环 | `config.js:48-52` PORT 整数化钳 1~65535；`boundedNum` 取整 |
| M-16 | 开放 | 已闭环 | `realAdapter.js:30-37` 白名单改用 hostname（去端口），带端口自定义基址可匹配 |
| M-17 | 开放 | 已闭环 | `routes.test.js` Host 白名单 + 401/期初余额/并发启动/保留地址 回归覆盖 |
| L-01 | 开放 | 刻意保留 | startup↔taskRunner 循环依赖仅注解未重构（ESM 初始化顺序未触发问题，低风险） |
| L-02 | 开放 | 刻意保留 | `web/vite.config.js` emptyOutDir:false 有意为之（避免误删），旧 hash 残留接受 |
| L-03 | 开放 | 已闭环 | 根 `package.json` 增加 test/lint/audit:deps 脚本 |
| L-04 | 开放 | 已闭环 | `startup.js` 注释修正为原子区单飞语义 |

## 汇总
- **23/25 已闭环**（代码修复到位）。
- **2/25（L-01/L-02）为刻意保留的设计权衡**，非漏洞。
- POST_FIX 报告基于 `d0c2df0`，其「25 项全开放」结论已过时；任务 tracker「全部 completed」对应当前 HEAD 状态，**正确**。

## 部署注意（deploy-smart-startup.sh，本地脚本未进仓库）
- 该脚本钉 `SHA=75ca13a`，且 step 4 硬编码旧前端资产 `index-BdxDtcor.js` / `index-DDj4U6BL.css`。
- 后端自 `75ca13a` 起无变更，钉 `75ca13a` 对后端有效。
- 若要部署新前端（`b627123` 重建为 `index-Ck0O1y4P.js` / `index-CzjUULqJ.css`），须将 `SHA` 改为 `e002c0e` **并同步更新 step 4 资产名**，否则 VPS 仍跑旧前端；若只改 SHA 不改资产名，`index.html` 会引用不存在的新 hash → 白屏。
- 本次已就地更新该脚本：`SHA=e002c0e` + step 4 资产名改为 `index-Ck0O1y4P.js` / `index-CzjUULqJ.css`。
