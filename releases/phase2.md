# Phase 2 · 安全隔离与加固（OPEN_MODE 全链路隔离 + 代理认证 + DNS 重绑定 + persist 单写者 + 同账号互斥锁）

> Tag: `phase2` → commit `63f75a0` ｜ 2026-08-13

## 改动要点
在 Phase 1 基础上，补齐首轮审计未闭环的高风险项：统一权限矩阵、代理认证加固、出站 SSRF（DNS 重绑定）、持久化竞态与同账号并发。

## 新增功能 / 问题修复
### Phase 2 主体（a245213）
- **统一权限矩阵（OPEN_MODE 全链路隔离）**：新增 `computeVisibleUserIds(db,req)`（管理员 / 非 OPEN_MODE 返回 null 全可见；OPEN_MODE 非管理员返回 Set：仅同 `/24` 网段 + 无 recordedIp 遗留账号）。
- assets / admin / tasks 端点由 `authRequired` 改 `adminOrAuthRequired`（OPEN_MODE 下强制 requireAdmin），匿名不再可读全量资产 / 后台统计 / 运营配置。
- **代理认证加固**：`config.proxyTrustedIps` + `parseCidrList`/`ipInCidrList`；代理分支要求 `PROXY_AUTH_HEADER` 否则 503、缺头 401、源 IP 不在白名单 403；`TRUST_PROXY_AUTH=true` 未配 header 则 `process.exit(1)` 拒启。
- 测试：authSecurity / assetLedger / assets / routesCore / authRoute 共 +11。

### Phase 2 收尾（63f75a0）
- **#182 notifier DNS 重绑定防护**：新增 `dnsGuard.js`（`isPrivateOrReservedIp` / `assertPublicDns`）；`notifier.safePushFetch` 出站 URL 先 `isSafePushUrl` 再 `assertPublicDns`，并补齐 webhook / bark 出站 SSRF 校验（P0-2 残留缺口）。
- **#183 persist 单写者 + 同账号互斥锁 + 优雅关机**：`store.persistChain` 单写者链避免并发写交错；`flushPersist` 改 async + `gracefulStop` `await` 后退出；`taskRunner.withAccountLock` 同账号串行化。
- 测试：dnsGuard(10) + notifier(7) + taskRunner(2) + store(1)，全套 389 通过。

## 关联
- 部署：`deploy-smart-startup.sh` 更新至 SHA `63f75a0`，fetch 清单增补 `dnsGuard.js`。
- 前置：Phase 1（f86a0c9）；后续：Phase 3（c63752b）。
