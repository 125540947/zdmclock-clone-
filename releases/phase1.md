# Phase 1 · 安全修复：阻断两条严重 Cookie 泄露路径

> Tag: `phase1` → commit `f86a0c9` ｜ 2026-08-13

## 改动要点
针对首轮安全审计暴露的两条严重 Cookie 泄露路径做根因阻断，并收紧默认鉴权。

## 新增功能 / 问题修复
- **smzdm 域名白名单**（`isSafeSmzdmUrl`）：仅允 `smzdm.com` 及其子域 + env 自定义基址，拒 IP / localhost / 其他公网域名——根治自定义端点任务把 `user.cookie` 发往任意公网 URL 批量窃取账号会话。
- **realAdapter.call 加固**：带 cookie 时强制白名单；`extraHeaders` 禁止覆盖 `Cookie/Authorization/Host/Origin/Referer` 等敏感头；`redirect:'follow'` → `'manual'` 并逐跳校验跳转目标（最多 3 跳），防 DNS 重绑定 / 内网跳转绕过。
- **油猴脚本移除 `?server=`**：导入脚本推送目标强制本服务 Host，`@connect` 收紧为确切域名，`Cache-Control:no-store`，消除脚本把完整 Cookie 发往任意地址的泄露面。
- **默认 `REQUIRE_AUTH=true`**：空 / 默认密码拒启；Docker 监听 `127.0.0.1:3000`。
- **测试**：notifier / realAdapter 补白名单与 cookie 守卫单测；修正 routes / routesCore 受旧宽松模型影响的断言（共 +若干，全套 358 通过）。

## 关联
- 部署：服务端零构建，前端未改动；`deploy-smart-startup.sh` 更新至 SHA `f86a0c9`。
- 后续：Phase 2（OPEN_MODE 全链路隔离 + 代理认证 + DNS 重绑定 + persist 单写者 + 同账号互斥锁）、Phase 3（时区 / assetLedger / health / 输入上限 / 限流器 LRU / HttpOnly Token）见各自 Release。
