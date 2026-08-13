# CHANGELOG — zdmclock-clone

> 本文件按**逻辑阶段**将仓库历史提交划分为若干批次，每批次含「改动要点 / 新增功能 / 问题修复」三段式更新说明。
> 提交范围：`cd98e39`（2026-08-05）至 `c63752b`（2026-08-13），共约 130 次提交。
> 维护规范：每次新增工作阶段，追加一个批次并沿用本结构（见文末「维护约定」）。

---

## 批次 1 · 项目奠基与一键部署体系（2026-08-05 ~ 08-07）

**改动要点**
- 确立项目基线：初始代码审计与审计报告归档，明确后续安全整改方向。
- 构建完整的一键部署链路：Docker 部署 + 交互式/完全自举的 `deploy.sh` / `deploy-vps.sh`，覆盖 Node 官方二进制安装、systemd 单元、目录安全校验。
- 引入服务自更新机制（ff-only pull + 按需重建 + 自重启，含 supervisor 托管与 Docker 检测）。
- 建立真实模式（real adapter）启用文档与部署前自检脚本。

**新增功能**
- Docker 一键部署（Dockerfile / compose / deploy.sh）。
- 零基础傻瓜式部署指南、Ubuntu 公网部署安全加固说明、独立 `DEPLOY.md`。
- 自更新：定时从仓库拉取更新并自重启。
- 真机端点一键验证脚本 `tools/verifyRealMode.mjs`（只读探测 signFormData / robot-token / 转盘与众测 activity_id 自动发现）。
- 真实模式启用图文指南。

**问题修复**
- 部署脚本多轮加固：禁止部署到 `/root` 等系统目录、systemd 写死 PATH 避免 `npm: command not found`、自动补回 `node_modules` 执行位（根治 Windows 拷贝丢 `+x`）、家目录追加遍历位、校验关键依赖包而非仅目录。
- `.dockerignore`/`.gitignore` 排除 `.hermes`，避免构建上下文撑爆磁盘。
- 复审缺陷全部修复（N1 / R2-R4 / S4-S10 / F2-F3 / F5 / S8 / b1-b9）。
- `.env` 重新生成时保留用户已设的 `SMZDM_ADAPTER`，避免重部署后变回 mock 假签到。
- 前端资源强制 `no-store` + 注入构建戳，击穿浏览器/代理旧 JS 缓存（根治抓包导入反复"应用失败"）。

**代表提交**：`cd98e39` `5d9a264` `fa92c03` `4933f78` `6404249` `bb50f5a` `8c0df75` `97cd404` `f6430bd` `11f609a` `1649946` `e8652cc` `d3f890d` `0c43a0c` `c17c24b` `af01adc` `2aca056` `16ff100`

---

## 批次 2 · 真实 smzdm 互动能力落地（2026-08-06 ~ 08-09）

**改动要点**
- 从"框架骨架"转向"真实可用"：补全 smzdm 真实接口、任务矩阵与资产账本、青龙社区真实任务移植。
- 建立 Cookie 录入与抓包导入的最后一公里：油猴一键抓取 + 浏览器导入器，降低用户使用门槛。
- 系统性修复点赞/收藏/评论的 `channel_id` 链路（好价 Deal 贴的真实频道取数）。

**新增功能**
- 任务矩阵补全 + 资产仪表盘（共享资产账本，A/B 模块协同）。
- 移植青龙社区真实任务：转盘 / 每日任务 / 签到额外奖励 / 众测，作为内置任务。
- 转盘/抽奖 `active_id` 与众测 `crowd_id` 自动获取。
- Cookie 失效检测 + 推送告警（防静默翻车）。
- 评论/收藏/点赞支持从好价列表取文章 + GPT 定时批量生成。
- 一键抓包导入器 `tools/importCapture.mjs`（替用户做抓包最后一公里）。
- 油猴一键抓取 smzdm Cookie 自动导入（按 `smzdmId` upsert + 脚本下载/安装）。
- 好价批量导入（服务端反爬挡死时改由浏览器导入）。
- `follow` 支持 `target` 数组轮询（每次运行下一个对象，游标持久化，向后兼容单字符串）。

**问题修复**
- 收藏端点从失效的 `www/zhiyou` 改为 APP 接口 `user-api /favorites/create`（与签到同机制）。
- 自动点赞迁到 `user-api rating/like_create`；点赞/收藏补真实 `channel_id`（解析 `article-api/article_detail/<id>`），彻底修复"无效的评论类型"。
- 点赞/收藏对齐社区脚本：补 `touchstone_event` + `token`(sess 值)，`resolveChannelId` 取 `article_channel_id`。
- `resolveChannelId` 取不到时复用上次成功值 / 退化为 `'1'`（www 兜底），保证全部文章可成功。
- 油猴抓取改用 url 参数匹配，覆盖 `.smzdm.com` 全子域与 HttpOnly 登录态（根治"请先登录"）；一键安装脚本在 `REQUIRE_AUTH=true` 下可用。
- 抓包导入健壮性：应用端点真正生效、跳过内置 `dailyTasks`、明确错误、前端过滤内置任务并提示 HTTP 状态；修复 `submitCaptures` 解构 bug（`applyCaptures` 已返回载荷本身，错误解构 `data` 致 `undefined.endpoints`）。

**代表提交**：`6e205f4` `e61369e` `308c881` `2c2cc72` `477fbf2` `7c74bd3` `d24ce7d` `93d501a` `31f99fa` `b78ff91` `03441ae` `3a2d1b4` `52e7a61` `86911e8` `900a5e8` `8ec05b2` `069fee3`

---

## 批次 3 · 第一轮安全审计整改（P0/P1/P2，2026-08-09 ~ 08-10）

**改动要点**
- 响应首轮代码审计，建立权限与安全防护基线：SSRF / XFF 伪造 / 水平越权（P0），凭据遮罩 / 速率限制 / 依赖审计（P1），可维护性清理（P2）。
- 引入 `OPEN_MODE` 开放模式，重构匿名访问与录入的权限模型。
- 引入 `mutationGuard` 中间件与 `withWriteLock` 持久化链雏形。

**新增功能**
- `OPEN_MODE` 开放模式：移除登录/Token 校验，业务接口对匿名放行，前端免登录；系统更新等高危操作仍受 `ADMIN_TOKEN` 保护。
- 开放录入细化：匿名仅可录入、改删需管理员 Token；录入记录真实访客 IP 并按 `/24` 网段可见；录入时勾选 `autoRun`。
- H2 更新接口独立 `ADMIN_TOKEN` 鉴权（与 `API_TOKEN` 隔离）。
- 速率限制（固定窗口，429 + Retry-After）雏形。
- 凭据遮罩（`maskCookie` 零内容泄露）、通用错误响应、进程兜底、写锁。

**问题修复**
- P0-1：任务端点 SSRF 初步防护（仅拒内网/回环/IPv6，放行公网域名——**此判定后续批次 6 被推翻并重做**）。
- P0-2：XFF 伪造绕过网段隔离初步修复（`getClientIp` 仅在 `trustProxy=true` 时信任 XFF）。
- P0-3：修复 clock 状态/历史接口水平越权，新增 `canAccessUser` 网段归属校验。
- 评审修复：扩展 `mutationGuard` 覆盖写/触发接口、推送 webhook SSRF 校验、baoliao 同段可见、凭据遮罩、写锁、通用错误、`parseJsonp`、前端门控与定时器清理。
- 开放模式审计修复：login 不再泄露 `ADMIN_TOKEN`、跨网段读取 `/smzdm`/`/refresh` 加网段校验、`extreme-lazy` 尊重 `autoRun`、前端管理员登录入口 + `X-Admin-Token` 注入。
- P1 系列：速率限制与账号上限（P1-1）、会话 Token 进 URL/可分发脚本泄露消除（P1-2）、GPT 批量生成释放写锁 + 散落日志接入 `dbgLog`（P1-3/7）、数据膨胀修复（P1-4）、时区一致性 + 抽公共解析模块（P1-5/6）。
- 依赖审计：`express` 下限 `^4.19.2 → ^4.21.2`。
- 测试补全：P0/P1 分支覆盖 + 修复 2 个真实 bug + `realAdapter` 防御分支 + 复盘文档。

**代表提交**：`34af60f` `92fbe1b` `15e8878` `20957ae` `33f6140` `0772a5c` `e1cc286` `06d89a0` `3267ea4` `917a91b` `9de072e` `4ac3503` `c627886` `e6747df` `792d5b4` `189241c`

> ⚠️ 说明：本批次为**首轮**安全整改，部分判定（尤其 P0-1 SSRF 仅拒内网却放行一切公网域名）在批次 6 外部审计复核中被认定为**未真正闭环**，并据此重做。

---

## 批次 4 · 极端懒人模式与好价导入打磨（2026-08-11 ~ 08-12）

**改动要点**
- 围绕"极端懒人"自动化流水线做体验与可靠性打磨：进度感知看门狗、实时日志回写、前端解构修正。
- 好价导入链路补强：服务端反爬场景下引导浏览器导入，导入支持携带 `channelId` 治本点赞/收藏失败。
- 该模式最终下线，转为更稳的"智能启动调度"。

**新增功能**
- 极端懒人流水线实时写回 `runRecord.logs`，前端「实时日志」可逐步观察进度。
- `/baoliao-import` 加 per-request nonce 放行内联脚本，并支持记住频道 ID（localStorage 持久化）。
- 浏览器导入好价支持携带 `channelId`（治本点赞/收藏失败）。

**问题修复**
- 极端懒人看门狗改为进度感知（日志持续增长即续命），真卡死保留日志。
- 修复面板永久"执行中"；`getExtremeLazyRuns` 解构修正——直接取 `res.runs` 不再多解构 `data` 层，历史记录与实时日志正常显示。
- `mergeBaoliao` 重导幂等更新 `channelId`，免去清空旧好价。
- 清理极端懒人修复前的旧 bundle 孤儿文件；补入前端构建产物 `web/dist`。
- 评论被限流时退避重试（max 2）提升成功率；好价刷新反爬场景温和降级（缓存命中不记失败、引导浏览器导入）。

**代表提交**：`7a3a04b` `53822b0` `c9e6070` `a69d0f1` `8c23ce3` `a356f47` `d3a0544` `60d6a17` `b69448c` `b31459d` `b912eca` `5d64cde`

> 注：全民众测 `error_code:12 来源错误` 对网页/服务端**硬拒**（浏览器登录态亦返回 12，仅 App 内可调用），服务端无法修复，本批次改为**软跳过**（不计入失败）。曾尝试 `appRequest` 带签名修复（1b75a79），实测仍 12 且破坏单测，已回退。

---

## 批次 5 · 管理员后台与前端健壮性（2026-08-12）

**改动要点**
- 前端管理员后台从"分散入口"升级为"聚合专用后台"（父路由 + 子导航 + 路由守卫），普通用户不可见入口也进不去。
- 修复因国内网络环境导致的白屏根因（境外字体 + dist hash 未入库），收紧 CSP。
- 修复开放模式管理员令牌被 reload 误删的体验缺陷。

**新增功能**
- 管理员专用后台聚合壳：`/admin` 父路由 + 子导航（总览 / distribution / update / notify）+ `AdminLayout` 返回前台/退出后台。
- 路由守卫 `beforeEach`：无 `zdm_admin_token` 访问管理路由重定向到 `userclock`。
- 全局登录浮层（未登录/401 时弹出），打通 `REQUIRE_AUTH` 下的管理入口。
- 后台只保留运维/管理员功能，用户页（账号/任务/爆料/偷懒）移出后台仅留普通界面。

**问题修复**
- 白屏修复：提交正确的构建产物（dist 新 hash 未入 git 致 jsDelivr 404），并清理 54 个历史旧 bundle。
- 移除被墙的 Google Fonts 依赖（render-blocking 致国内白屏），改用系统字体栈并收紧 CSP。
- 开放模式匿名登录不再下发空 `adminToken`，避免 reload 误删管理员令牌导致后台入口闪退（纯后端改动，`auth.js` 不下发 `adminToken` 字段，前端跳过清空分支）。
- 管理员登录静默失败：检查 `adminToken` 缺失时明确提示；后台退出按钮更名「退出后台」并澄清语义。

**代表提交**：`541f432` `3a9fc96` `3dcc9fd` `b41d91f` `bbe19ea` `564e246` `a02f729` `629331d` `c286f71`

---

## 批次 6 · 外部审计复核安全闭环（Phase 1/2/3，2026-08-12 ~ 08-13）

**改动要点**
- 引入**独立外部审计**（只读、未改代码）复核首轮整改，逐条对照核实并推翻过度乐观判断，据此分三阶段（Phase 1/2/3）系统性重做。
- 重点纠正首轮未闭环的高危项：Cookie 泄露两条路径、OPEN_MODE 全链路隔离、代理认证、DNS 重绑定、持久化竞态、localStorage 长期 Token。
- 中风险项：时区统一、资产账本字段语义、health 并发、输入上限、限流器 LRU、Token HttpOnly。

**新增功能**
- **Phase 1（严重 + 默认鉴权）**：smzdm 域名白名单（`isSafeSmzdmUrl` 仅允 smzdm 域 + env 基址）；`realAdapter.call` 带 cookie 时强制白名单、禁覆盖敏感头（Cookie/Authorization/Host 等）、`redirect:'follow' → 'manual'` 逐跳校验；油猴脚本移除 `?server=` + `@connect` 收紧 + `no-store`；默认 `REQUIRE_AUTH=true`（空/默认密码拒启）。
- **Phase 2 主体（全链路隔离 + 代理认证）**：`computeVisibleUserIds` 统一权限矩阵（OPEN_MODE 下匿名仅同 `/24` 网段可见）；assets/admin/tasks 端点改 `adminOrAuthRequired`；代理认证要求 `PROXY_AUTH_HEADER` 否则 503、缺头 401、源 IP 白名单 403；`TRUST_PROXY_AUTH=true` 未配 header 则拒启。
- **Phase 2 收尾**：notifier `safePushFetch`（出站 URL 先 `isSafePushUrl` 再 `assertPublicDns` 防 DNS 重绑定，补齐 webhook/bark SSRF 校验）；`store.js` 持久化串入单写者 `persistChain`；`flushPersist` 改 async + 优雅关机 `await`；`taskRunner.js` `withAccountLock` 同账号串行。
- **Phase 3**：时区 `zonedWallClock(config.tz)`；assetLedger 字段语义修正；`health` 并发探测 + `AbortSignal` 截止（慢依赖 `degraded` 不致命）；零依赖 `validation.js` 输入上限；限流器 LRU `maxEntries` 硬淘汰；**Token HttpOnly**（零依赖 `parseCookies` + `res.cookie(httpOnly)` 下发 `zb_token`/`zb_admin_token` + `POST /auth/logout` + `/config` 推导 `loggedIn/isAdmin`；前端 `withCredentials` + `session.js` 响应式状态替换 localStorage 明文 Token）。

**问题修复**
- 推翻并重做 P0-1 SSRF：`isSafeSmzdmUrl` 仅 smzdm 域白名单（首轮放行一切公网域名仍可被 `def.endpoint` 设为任意公网 URL 批量窃取账号会话）。
- 推翻并重做 P0-2 XFF：`getClientIp` 默认忽略 XFF，用不可伪造 `req.ip`，仅在 `TRUST_PROXY=true` 才信 XFF（首轮"仅在 trustProxy 时信任"表述模糊，实测需显式加固）。
- 加固 P0-3 水平越权（GET `/users/:id/smzdm`、POST `/users/:id/refresh` 补同网段校验）。
- `index.js /api/health` 调 `load()` 未定义致全量测试崩溃 → 补 `import { load }`。
- 纵深加固：错误响应默认泛化（`config.debug` 关，不再依赖 NODE_ENV）、`express.json({limit:'256kb'})`、限流默认 key 改不可伪造 `req.ip`、CORS 默认 `origin:false`、install-script 仅 `INSTALL_TOKEN`。
- 前端白屏隐患（境外字体）已在批次 5 修复，本批次无新增。

**测试与部署**
- 后端测试随三阶段从 358 → 369 → 389 → **401/401** 全绿（累计新增约 43 项：validation 9 / health 4 / assetLedger 1 / rateLimit 2 / startup.tz 1 / authRoute cookie 2 / dnsGuard 10 / notifier 7 / taskRunner 2 / store 1 等）。
- 部署脚本 `deploy-smart-startup.sh`（工作区根，未进仓库）按 SHA 走 jsDelivr 镜像拉单文件，最新已部署 SHA = `c63752b`（fetch 清单含 health/validation/rateLimit/baoliao 等）。

**代表提交**：`f86a0c9` `a245213` `63f75a0` `c63752b` `235d1c9` `d7859da` `530cc25` `b31392d`

---

## 维护约定（默认规范）

1. **分批原则**：每次整理历史或新增工作阶段，按**逻辑阶段**（功能/安全波次）或**时间**划分为批次；同一波次跨多日可合并为一批次。
2. **批次结构**：每个批次用 `## 批次 N · 标题（时间范围）` 分隔，内部固定三段：
   - **改动要点**：该批次的设计意图与架构性调整。
   - **新增功能**：用户/系统可见的新能力。
   - **问题修复**：修复的具体缺陷（含关键 commit hash 与原因）。
3. **代表提交**：每段末尾列出 3–12 个代表性 commit hash，便于回溯；不要求穷举。
4. **追加而非重写**：后续工作追加新批次（如「批次 7 · …」），不重写历史批次；若某批次结论被后续推翻，在旧批次内加 `⚠️ 说明` 标注，新批次写明纠正。
5. **落库位置**：本 `CHANGELOG.md` 存于仓库根；安全/部署等长期不变量仍记于 `.workbuddy/memory/MEMORY.md`。
6. **触发**：每次完成一个具有独立主题的工作阶段（如一个 Phase、一轮审计整改、一次大功能）后，追加对应批次。
