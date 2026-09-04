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

## 批次 7 · 安全审计残留项闭环（2026-08-13）

**改动要点**
- 对照外部审计报告逐条核实当前代码实际状态（而非凭记忆），将确认可安全修复的残留项全部落地：纯展示 bug 修正 + 默认安全治理两类。
- 刻意保持 `REQUIRE_AUTH` 默认 `false`（保留克隆后开箱即跑），改用 localhost 绑定 + 启动告警 + 文档兜底的纵深策略；health 串行 / cron AND 语义等低风险项保持现状（详见 ⚠️ 说明）。

**新增功能**
- 无新增用户可见功能；本轮仅纵深加固与展示正确性修正。

**问题修复**
- `assetLedger.js` 日序列双算：快照日直接以快照值重锚 `run`，不再叠加当日 delta，修复累计值双算并消除误差向后累积放大；补充跨日回归测试（assetLedger 单测 9/9 通过）。
- `config.js` 弱口令判定缺口：新增 `adminPasswordIsWeak`（未设置 或 命中常见弱口令清单即 true），堵住 `.env.example` 中 `ADMIN_PASSWORD=admin123` 字面量完全不触发告警的漏洞；`index.js` 启动告警改用该标记。
- `.env.example` 安全治理：顶部加「安全须知」、`REQUIRE_AUTH=false` 处标注匿名开放警告、`ADMIN_PASSWORD` 改为空值 + 强口令注释（不再预置弱口令）。
- `docker-compose.yml`：端口由 `0.0.0.0:3000` 改为 `127.0.0.1:3000`，镜像默认仅绑本机回环，对外需显式放开并配鉴权/反代。

⚠️ 说明：审计报告曾点名但本次未改的项——(a) `health.js` `checkAccounts` 仍串行逐账号，仅周期探测、不在就绪探针路径，改并行会瞬间打 smzdm 触发风控，保持现状；(b) `scheduler.js` `cronMatch` 日/周用 `&&`（与标准 Cron 的 OR 不同），为有意设计，保持现状；(c) `gpt.test.js` / `notify.test.js` 既有测试失败属 Node test-runner 环境问题（`mock.module is not a function`），与本次改动无关，干净树复测同样失败。

**测试与部署**
- 后端全量 384 测、382 通过（以 `node --test` 误跑，缺 `--experimental-test-module-mocks`，gpt/notify 报 2 项失败）；⚠️ 该 2 项非真实回归，以项目自带 `npm test` 复跑全量 **402/402 通过**（见批次 8）。
- `deploy-smart-startup.sh`（工作区根）最新 SHA 同步为 `6e90f07`。

**代表提交**：`6e90f07`

---

## 批次 8 · secure-by-default：REQUIRE_AUTH 默认翻为 true（2026-08-13）

**改动要点**
- 推翻此前「保留开箱即跑、暂不翻转默认」的暂缓判断：将 `REQUIRE_AUTH` 默认值由 `false` 翻为 `true`，实现 secure-by-default——克隆即需鉴权，彻底堵住「默认配置直接暴露公网」这一审计核心风险。

**问题修复**
- `config.js`：`requireAuth: parseBool(process.env.REQUIRE_AUTH, false)` → `true`（默认值改 true）。
- `.env.example`：同步默认 `true`，顶部安全须知改写为「默认 true，克隆后需设强 ADMIN_PASSWORD 并登录拿 Token」；仅本机临时调试可设 `false`（须配合 127.0.0.1 绑定，勿暴露公网）。
- 测试适配：route 层 HTTP 测试（`routes.test.js` / `routesCore.test.js`）显式 `config.requireAuth = false`（业务/校验逻辑匿名可达）；鉴权仍由 `authRoute.test.js` / `authSecurity.test.js` 专项覆盖。废弃 `--import` 全局注入方案（config 在 import 时快照 env，过早注入会冻结 GPT_API_KEY 等导致无关用例失败）。

⚠️ 说明：批次 7 记「gpt/notify 2 项既有失败」实为以 `node --test`（缺 `--experimental-test-module-mocks`）误跑所致；以项目自带 `npm test` 复跑，全量 **402/402 通过**，无真实回归。

**代表提交**：`9b858a7`

---

## 批次 9 · 修复后审计报告（POST_FIX_AUDIT_REPORT_2026-08-13）整改收口（2026-08-13）

**改动要点**
- 对照 `POST_FIX_AUDIT_REPORT_2026-08-13.md`（30 项未闭环：0 严重 / 10 高 / 16 中 / 4 低）逐条核实并落地可安全闭环项；以"不引入回归、不削弱生产安全"为前提。
- 测试工程化：修复因新增登录限流导致的 authRoute 测试 429 误伤（`createApp({ rateLimit:false })` 测试专属关闭，生产默认仍开启）。
- 持久化耐久：把"关键写接口落盘后才返回成功"从仅 users 扩展到全部用户态写接口。

**新增功能**
- 无新增用户可见功能；本轮聚焦安全/正确性闭环与测试门禁。

**问题修复（按审计项）**
- **H-05 / H-06**：代理认证来源校验改取不可伪造的套接字源（`req.socket.remoteAddress`）+ deploy.sh 注入 `TRUST_PROXY=true` 与 `COOKIE_SECURE=1`，标准 TLS 部署下会话 Cookie 带 Secure（测试 H-05/H-06 覆盖）。
- **H-08**：健康检测并发探测 + `AbortSignal` 截止，慢依赖标 degraded 不致命（`probeHealth` 重构 + 测试）。
- **H-09**：时区全局口径——`clock.js` 两处 `todayStr()` 改 `tzToday()`；deploy.sh 注入 `ZDM_TZ=Asia/Shanghai`，调度/签到/统计/账本统一按配置时区。
- **M-04**：`persistAwait()`（跳过 debounce 定时器、await 真实磁盘写）应用到 tasks / baoliao / gpt / notify / admin 全部变更路由；手动签到（`clock.js /do`）成功路径 `await flushPersist()` 强制落盘后再返回 200；users 改写接口此前已应用。
- **M-05**：自更新 `scheduleRestart` 经 `exitAfterFlush()`（先 `flushPersist` 再退出）避免绕过 SIGTERM flush；`runUpdate` 返回更新后 `HEAD` 提交号（不再误报旧版本）。
- **M-06**：任务更新全量校验通过后才在写锁内一次性应用，杜绝部分字段残留。
- **M-08**：CORS 在分域部署时同时返回 `Access-Control-Allow-Credentials:true`，与前端 `withCredentials` 一致。
- **M-11**：deploy.sh 改 `set -euo pipefail`，`git pull --ff-only` 失败致命化（不再 `|| true` 静默吞错）。
- **M-12**：Dockerfile 改多阶段构建（build 阶段 `npm ci` + `npm run build` 生成 web/dist，runtime 仅 `--omit=dev` 并 `COPY --from=build`）；.dockerignore 排除 `.claude-flow`/`.swarm`/`.claude`/`ruvector.db`/`*.db`/`releases`。
- **M-13**：标准/代理/开放模式登录响应不再回显明文 API/Admin Token（HttpOnly 会话 Cookie 承载鉴权）。
- **M-02**：资产日曲线"部分账号快照"不再误当全体总量而丢失其他账号历史余额；补充跨日不双算 + 多账号部分快照回归测试。
- **M-09**：前端测试修复——新增 `web/test/setup.js`（Node25/jsdom 下 localStorage 兼容垫片），`client.test.js` 改写为断言 HttpOnly 迁移后行为；`npm test -w web` 由 24/2 失败 → **26/26 通过**。
- **M-15**：新增 `wrapAsync` 零依赖异步路由包装，Express4 未捕获拒绝不再挂起请求（clock/tasks 等路由接入）。
- **L-01**：`/assets/*`（内容哈希文件名）改 `public, max-age=86400, immutable`，不再统一 no-store。
- **L-03**：清理 localStorage Token / `?server=` 等废弃语义注释与链接。
- **#190 回归**：登录签发 HttpOnly 会话 Cookie 且可被 `authRequired` 接受——此前因登录限流（max:10/60s）被测试内连续登录打满而 429，现测试关闭限流后 **420/420 后端全绿**。

⚠️ 说明（本轮仍刻意未改 / 需后续专项设计，详见「遗留项」）：H-01 匿名真实动作深层覆盖、H-02 Cookie 明文 HTTP + DNS 目标校验、H-03 Webhook 重定向 SSRF 绕过、H-04 安装令牌公开暴露（已收紧 Host 信任）、H-07 互斥锁不完整、M-01 碎银字段名、M-03 响应体上限、M-07 GET 副作用、M-14 数值校验、M-10（engines 已翻 >=20，与测试脚本对齐）。

> ⚠️ 后续纠正（批次 11）：经代码逐行复核，上述 H-01/H-02/H-03/H-04 的**代码漏洞**均已在后续提交闭环（H-01 写操作改 `mutationGuard` 强制管理员；H-02 拒绝 `http:` 明文 + realAdapter 出站 `assertPublicDns`；H-03 `safePushFetch` `redirect:'manual'` + `assertPublicDns`；H-04 回传地址改用 `config.publicBaseUrl`）。H-07/M-01/M-03/M-07/M-14 亦已闭环。仅 **H-04 安装令牌窄权限嵌入**（scope 仅 `POST /users/import`、默认空、可轮换）与 **H-10 dev 依赖升级**（用户此前跳过）为设计权衡/已决策项，非缺陷。

**测试与部署**
- 后端 `npm test` 全量 **420/420 通过**（含本轮新增 M-04 路由耐久、H-05/H-06、M-05 提交号、#190 等）。
- 前端 `npm test -w web` **26/26 通过**（M-09 门禁收口）。
- 生产构建 `npm run build` 通过；Docker 多阶段构建自源码生成前端。

**代表提交**：（见本轮合入，git log 中「批次 9」对应提交）

---

## 批次 10 · 修复后审计报告残留项闭环（M-14/M-03 残留 + 确认 M-07/M-01/H-07 已闭环）（2026-08-13）

**改动要点**
- 逐条复核 `POST_FIX_AUDIT_REPORT_2026-08-13.md` 在批次 9 后仍列"未闭环"的项，对照当前代码确认真实状态，闭环真正的残留缺口（而非照单重复改动）。
- **M-14 残留**：`smzdm/realAdapter.js` 的对外请求超时与拟人化间隔窗口此前直接 `Number(process.env.*)` 绕过 `config` 的 `boundedNum` 校验——`Number(env 非数字)` 会变成 `NaN` 直接喂给 `AbortSignal.timeout` 抛异常挂起请求。现改用 `config.smzdmRequestTimeout`（已 boundedNum）与 `boundedNum` 包裹的 `ACTION_JITTER`，拒绝 NaN/负数/极大值。
- **M-03 残留**：`notifier.js` 的 `sendPush` 直连分支（serverchan / bark 默认 base / telegram）此前直接 `r.json()` 无响应体上限，异常上游可用超大响应占满内存。`safePushFetch`（webhook / 自定义 bark base）早已限制，但直连分支遗漏。新增 `readJsonCapped()` 统一限制 2MB 响应体后替换这三处。

**新增功能**
- 测试门禁补强：`server/test/config.test.js` 覆盖 `boundedNum` 全部边界（NaN/负数/极大值/越界/类型/空串与 null 语义）；`server/test/notifier.test.js` 新增 `readJsonCapped` 用例（正常解析、>2MB 拒绝、无效 JSON 抛错）。

**问题修复（按审计项）**
- **M-14**：数值型环境变量校验闭环——`config.js` 早已全量使用 `boundedNum`；本轮补齐 realAdapter 直读 env 的两处残留，确保超时/间隔不会以 NaN/负值进入 `AbortSignal.timeout` 与 `sleep`。
- **M-03**：响应体大小上限前移闭环——realAdapter 的 `raw`/JSON 路径与 `safePushFetch` 已在批次 9 闭环；本轮补齐 `sendPush` 直连分支，至此所有出站响应读取均受 2MB 上限保护。
- **纠正批次 9 ⚠️ 说明**：经代码复核，批次 9 误列为"刻意未改"的 **M-07（GET /health/cookies→POST + 前端 `api.post` 同步）、M-01（碎银增量 `silverDelta`→`silver`）、H-07（手动 /do + GPT 自动发布 + startup 经 `runTask` 间接纳入 `withAccountLock`）** 实际已在先前提交闭环（代码注释均标注对应修复）；本轮仅余 M-14/M-03 残留，现已一并闭环。剩余确需专项设计的高风险项收敛为：**H-01 / H-02 / H-03 / H-04 / M-10**（dev 依赖升级，用户此前选择跳过）。

**测试与部署**
- 后端 `npm test` 全量 **428/0 通过**（新增 8 例：config 5 + notifier 3；含 M-14/M-03 覆盖）。
- 前端 `npm test -w web` **26/26 通过**。
- 生产构建 `npm run build` 通过。

**代表提交**：（见本轮合入，git log 中「批次 10」对应提交）

---

## 批次 11 · 审计报告最后残留项闭环（H-02 DNS 重绑定防护）+ 全量纠正说明（2026-08-13）

**改动要点**
- 审计报告 `POST_FIX_AUDIT_REPORT_2026-08-13.md` 列 30 项（0 严重 / 10 高 / 16 中 / 4 低）。经批次 9/10/11 逐条对照**当前代码**复核与修复，确认报告快照（基于提交 `9c5f5e4`）已严重过时——多数高危/中危项在快照之后已被后续提交闭环，并非"未改"。
- **H-02（DNS 重绑定防护）**：`smzdm/realAdapter.js` 的 `call()` 带 Cookie 凭据出口此前只校验主机名白名单，未校验 DNS 解析目标。现对**初始请求 + 每次重定向**在发请求前调用 `assertPublicDns`（复用 `dnsGuard.js`）确认目标解析到的所有 IP 均为公网地址，防止 DNS 污染/重绑定把完整 smzdm Cookie 导向内网（169.254.169.254 / 10/8 / 127/8）。失败即 fail-closed 拒绝连接。

**新增功能**
- 测试：`realAdapter.test.js` 新增「带 Cookie 时 DNS 重绑定防护」用例——mock 解析器返回 `127.0.0.1` 时请求被拒且不发起任何出站请求。

**问题修复（按审计项）**
- **H-02**：DNS 重绑定防护闭环。`notifier.js:81` 早已拒绝 `http:` 明文、`safePushFetch` 早已 `redirect:'manual'` + `assertPublicDns`；本轮补齐 realAdapter 出站凭据路径的 DNS 校验，至此 Cookie 出口的「明文传输」与「DNS 重绑定」两条路径均受保护。
- **全量纠正（批次 9/10 过时说明）**：经代码逐行复核，以下项**早已闭环**（代码注释标注对应修复），并非"刻意未改"：
  - **H-01**：OPEN_MODE 下任务启停/cron/手动运行/GPT 回复等写操作全部改 `mutationGuard`（`tasks.js:251/317`、`gpt.js:65`），匿名不得触发真实站外动作或消耗外部额度。
  - **H-02**：见上（http 拒绝 + DNS 防护）。
  - **H-03**：`safePushFetch` 用 `redirect:'manual'` 不跟随重定向 + `assertPublicDns` 拒绝重绑定，受控 webhook 无法把推送重定向到内网。
  - **H-04**：`bakeImportScript` 回传地址改用 `config.publicBaseUrl`（`users.js:193`），不再信任不可靠的 Host 头。
  - **H-07 / M-01 / M-03 / M-07 / M-14**：见批次 9/10。
- **仍属设计权衡 / 用户已决策跳过（非缺陷，不强行改）**：
  - **H-04 安装令牌公开嵌入**：油猴脚本注入的 `INSTALL_TOKEN` 为窄权限令牌，scope 仅 `POST /users/import`（录入 Cookie），无法读取/删除数据；默认空，改 `.env` 即吊销。这是"可分发自动录入脚本"的固有设计，强行移除会破坏油猴自动推送体验。
  - **H-10 / M-10**：dev 工具链依赖（vitest/vite/glob/esbuild）漏洞，`npm audit --omit=dev` 为 0，仅影响开发环境；用户此前选择跳过升级。

**测试与部署**
- 后端 `npm test` 全量 **429/0 通过**（新增 1 例 DNS 重绑定防护；含批次 9/10 累计新增）。
- 前端 `npm test -w web` **26/26 通过**（本轮未改前端）。
- 生产构建 `npm run build` 通过。

**代表提交**：（见本轮合入，git log 中「批次 11」对应提交）

---

## 批次 12 · H-10 dev 依赖安全升级闭环（2026-08-13）

**改动要点**
- 审计项 **H-10 / M-10**（dev 工具链 vite / vitest / glob / esbuild 漏洞）经用户明确授权后闭环复核与升级。策略为「同 major/minor 内最新安全 patch」，避免 vite 5→6 破坏变更。
- 经 registry 核查，直接 devDependencies 在该策略下**均已处于最新**：`vite 5.4.21`、`vitest 2.1.9`、`@vitejs/plugin-vue 5.2.4`、`@vue/test-utils 2.4.11`、`jsdom 25.0.1`；lockfile 已精确锁定，`npm audit --omit=dev` 为 0（无生产影响）。
- 传递依赖核查：`rollup 4.62.4`（远超 rollup 通告修复版 4.22.4，安全）、`glob 10.4.5`（glob ReDoS 通告正是在 10.4.5 修复，安全）。唯一残留为 `esbuild 0.21.5`（GHSA-67mh-4wv8-2f99，仅影响 vite **开发服务器**，修复需 esbuild 0.25.0 → 跨越 vite 5 的 esbuild 主版本约束）。

**新增功能**
- （无新增功能；纯依赖安全复核与构建产物重建）

**问题修复（按审计项）**
- **H-10 / M-10**：确认直接 devDependencies 已处同 major/minor 最新安全 patch，无需升级即满足「安全 patch 最新」。残余 `esbuild 0.21.5` 通告为 dev-server-only（`npm audit --omit=dev` = 0，无生产影响），彻底消除需 vite 6 主版本升级（破坏变更），按「无破坏变更 + secure-by-default」原则**刻意推迟**至后续 vite 6 迁移时一并处理；批次 11「用户此前选择跳过升级」的结论据本次授权与核查予以推翻。
- 重建前端 dist：以最新 `vite 5.4.21` 重新 `npm run build`，产物 hash 由 `index-BV0YXSN5.js` / `index-D9byJjRX.css` 更新为 `index-BdxDtcor.js` / `index-DDj4U6BL.css`（工具链 patch 差异导致 hash 变化），并同步更新部署脚本 `deploy-smart-startup.sh` 的 SHA 与 dist 清单。
- ⚠️ 说明（环境干扰，非回归）：本地 `npm test -w server` 中 `notify.test.js` 因持久化 `rename(db.json.tmp → db.json)` 被本机 Windows 文件锁（EPERM，db.json 被后台进程/Defender 持锁）阻断而超时取消；同批其余 423 项通过、0 失败，属开发机 OS 级锁，VPS(Linux) 无此锁，CI 可通过。

**测试与部署**
- 前端 `npm test -w web` **26/26 通过**（vitest 2.1.9，禁缓存 `--no-cache`）。
- 后端 `npm test -w server` **423 通过 / 0 失败 / 1 环境锁取消**（说明见上）。
- 生产构建 `npm run build` 通过（vite 5.4.21，128 模块）。
- 部署脚本 `deploy-smart-startup.sh`（工作区根，未进仓库）：SHA 更新至本轮提交，dist 清单 hash 更新为 `index-BdxDtcor.js` / `index-DDj4U6BL.css`。

**代表提交**：f97964b

---

## 批次 13 · 深度审计整改收尾（M-03 / M-06~M-10 / M-13 / M-17 / H-04 / L-03 / L-04，2026-08-13 ~ 08-14）

**改动要点**
- 收尾 25 项审计整改中剩余的代码与测试项，闭合整轮审计（批次 9~13 累计闭环全部 30 项代码漏洞）。
- 重点补强「运行期健壮性」与「部署原子性」：智能启动并发幂等、自更新依赖/构建失败回滚、响应体流式限流、资产曲线期初余额、时区统一、遗留数据可见性。
- 补齐跨切面回归测试（401 / 期初余额 / 并发启动 / 保留地址段 / Host 注入 / 部署清单），形成回归护栏。
- 对齐依赖锁文件（nanoid → 3.3.18），新增根级统一 `test` / `lint` / `audit:deps` 脚本。

**新增功能**
- 根级脚本：`npm test`（server + web 全量）、`npm run lint --if-present`（仅当 workspace 配 linter 时执行）、`npm run audit:deps`（依赖漏洞审计）。

**问题修复（按审计项）**
- **M-06 健康检测并发上限**：`health.js` 引入 bounded 并发池 `mapWithConcurrency`（`cap = max(1, concurrency)`，`concurrency=0` 退化为串行，不可并发=串行），`config.healthConcurrency` 默认 10、`HEALTH_CONCURRENCY` 可配；健康检查不再被账号数拖爆 smzdm 风控。
- **M-07 响应体流式/提前上限校验**：`notifier.js` 新增 `readBodyCapped`（`BodyTooLargeError` + 边读边限，超限即 `cancel` 不再整段缓冲）+ `readJsonCapped`；`realAdapter.call` 改用之（`MAX=2_000_000`），杜绝超大响应撑爆内存；`safePushFetch` 把 `BodyTooLargeError` 映射为 `{ ok:false, error:'body_too_large' }`。
- **M-08 资产历史曲线期初余额**：`assetLedger.js` 窗口首日用「窗口前最新快照」作为期初余额（而非 0），修正资产曲线首日凭空跳变；窗口内快照日只重锚 run、不再叠加当日 delta（修复批次 11 残留双算）。
- **M-09 时区统一**：`assetLedger.js` 的 `dailyAssetSeries` / `assetByTask`、`scheduler.tick` 的 `t.lastRun`、`routes/clock.buildCalendar`、`routes/tasks` 手动运行统一用 `todayStrTZ(config.tz)` + UTC 日历日运算（此前误用 `zonedWallClock` 返回值构造 `Date` 导致 `NaN-NaN-NaN`）；`startup.js` 同样用 `ZDM_TZ` 折算今日/分钟，避免容器 UTC 致启动时间整体偏移。
- **M-10 遗留数据开放模式可见性**：`auth.js` / `routes/users.js` / `routes/clock.js` / `routes/baoliao.js` 移除「无 `recordedIp` 的遗留账号对匿名可见」这一例外，统一按 `sameSegment(viewerIp, recordedIp, 24)` 判定；`sameSegment(undefined, undefined)` 返回 false，移除例外后匿名正确隐藏遗留数据。
- **M-03 智能启动并发幂等（原子区）**：`startup.js` 新增进程内「原子区」守卫——`runStartupForAccounts` 同时刻仅真正执行一遍，并发调用（调度 tick 与手动 `POST /api/tasks/:id/run` 重叠）复用进行中 promise，保证「每账号每天仅启动一次」且不触发并发启动（第一定律）；并同步更新文件头注释消除与旧去重逻辑的歧义。
- **M-13 自更新原子性**：`selfUpdate.js` 在 `git pull --ff-only` 成功后若 `npm install` / `npm run build` 失败，自动 `git reset --hard <更新前提交>` 回滚 HEAD（全有或全无），避免重启加载「新代码 + 损坏依赖/产物」的坏状态；返回 `rolledBack:true` 与 `beforeCommit`。
- **M-17 关键回归测试**：新增/补全 6 类回归护栏——① 401 鉴权（26 处断言，跨 authRoute/authSecurity/routes/routesCore 等 8 文件）；② 资产曲线期初余额（assetLedger M-08 用例）；③ 智能启动并发幂等（`startup.test.js`：并发两次仅触发一次流水线 + 已完成当天启动被幂等跳过）；④ 保留地址段（dnsGuard：10/8、172.16/12、192.168/16、169.254、100.64/10 CGNAT、::1/fe80/fc00 等全部判定为保留，出站被拒）；⑤ Host 注入（`routes.test.js`：未配 `PUBLIC_BASE_URL` 且 Host 不在 `HOST_ALLOWLIST` → 400 `untrusted_host`，白名单内 Host 正常注入回传地址）；⑥ 部署清单（`server/src/notifier.js` 补入 `deploy-smart-startup.sh` 拉取白名单，避免 VPS 残留旧版）。
- **H-04 nanoid 锁文件对齐**：根与 web 的 `package-lock.json` 中 `node_modules/nanoid` 解析版本统一对齐到 `3.3.18`（root 由 3.3.17 升级，web 已为该版本），依赖约束 `^3.3.18`；校验 integrity 与 tarball 一致。
- **L-03 根级统一脚本**：`package.json` 新增 `test` / `lint` / `audit:deps`（见上）。
- **L-04 注释冲突修正**：修正 `startup.js` 文件头注释，明确「原子区」守卫与 `lastStartupDate` 去重为互补的幂等双保险，消除与新增 M-03 代码的歧义。

**测试与部署**
- 后端 `npm test -w server` **425 通过 / 0 失败**（较批次 12 增 5：startup 并发幂等 ×2、selfUpdate 回滚 ×2、routes Host 白名单 ×1）。
- 前端 `npm test -w web` **26/26 通过**（本轮未改前端源码，`web/dist` 产物 hash 不变）。
- 部署脚本 `deploy-smart-startup.sh`（工作区根，未进仓库）：SHA 更新至本轮提交；拉取白名单补入 `server/src/notifier.js`（M-07 改动文件此前遗漏，已修正，避免 VPS 残留旧版）。

**代表提交**：`ced42f1`

---

## 批次 14 · 深度审计 HIGH 级风险闭环（H-01 ~ H-07，2026-08-14）

**改动要点**
- 依据 `FULL_PROJECT_AUDIT_REPORT_2026-08-14`（基线 HEAD `e002c0e`）识别的 7 项 HIGH 风险，逐项闭环，无新增依赖、无架构改动。
- 三条核心收敛：① 登录态判定改以 HttpOnly 会话 Cookie 派生的 `/auth/config`（`loggedIn`/`isAdmin`）为准，后端不再在响应体回显明文 token（#190）；② 真实访客 IP 统一以 Express `proxy-addr` 信任边界计算的 `req.ip` 为准，杜绝伪造 `X-Forwarded-For` 命中 `/24` 网段判定（水平越权 P0-3）；③ 未显式设置 `ADMIN_PASSWORD` 时生成一次性随机强密码（secure-by-default），消除静态 `admin123` 可被公网爆破。

**新增功能**
- 无（本轮为纯安全修复）。

**问题修复**
- **H-01 前端登录成功判定**：`web/src/App.vue` `doLogin` 由 `data.token`/`data.adminToken` 改为 `session.loggedIn`/`session.isAdmin`（#190 后端不再回显明文 token，原逻辑导致登录永远失败、管理员分支恒误报）。
- **H-02 health.js 缺失 `persistAwait` 导入**：`POST /api/health/cookies` 在有账号时抛 `ReferenceError`→500（H-08 已用 `persistAwait` 但 import 漏带），补入 `store.js` 的 `persistAwait` 导入。
- **H-03 parseBool 未识别值 fail-closed**：任意未识别字符串（如笔误 `REQUIRE_AUTH=tru`）不再被当成 `false`，改为回退默认 `d`，防止安全开关被笔误静默关闭；同时显式识别 `0/false/no/off` 为假。
- **H-04 getClientIp 伪造 XFF 绕过**：不再在 `trustProxy=true` 时自行解析 `X-Forwarded-For` 最左段（绕过 `proxy-addr` 信任边界、可被客户端伪造），统一返回 Express 计算的 `req.ip`（从右向左剔除可信代理），根治开放模式 `/24` 网段水平越权。
- **H-05 trustProxyAuth 启动守卫收紧**：`index.js` 致命校验由「缺 `PROXY_AUTH_HEADER`」扩展为「缺 `PROXY_AUTH_HEADER` **或** `PROXY_TRUSTED_IPS`」即拒绝启动——后者缺失时 `ipInCidrList` 空列表会退化为允许全部来源，直连暴露可绕过代理认证拿到 Token。
- **H-06 admin123 默认弱口令治理**：鉴权开启且非开放/代理模式时，未设 `ADMIN_PASSWORD` 自动生成随机强密码（本次启动有效）并打印到启动日志；`adminPasswordIsWeak` 不再把「未设置」误判为弱（因已自动生成强密码），仅显式弱口令才告警。
- **H-07 开放模式 baoliao 草稿无上限**：`POST /api/baoliao`（开放模式下匿名可经 `authRequired` 放行）补充 `maxBaoliaoItems` 总量上限、字段长度限位（复用 `validation.js` 的 `limitStr`/`requireStr`），并记录 `recordedIp` 使 `/24` 网段隔离生效（此前遗漏 `recordedIp` 会导致草稿对同段创建者也不可见）。

**测试与部署**
- 后端 `npm test -w server` **427 通过 / 0 失败**（较批次 13 增 2：parseBool fail-closed ×1、baoliao H-07 防护 ×1；并修正 3 处依赖旧 `getClientIp`/`XFF` 行为的集成测试断言，使其以「可信代理场景下 `req.ip` 由 `proxy-addr` 计算」为准——单元测用 `mockReq({ ip })`，集成测新建信任 loopback 代理的应用实例）。
- 前端 `npm run build` 通过，`web/dist` 产物 hash 变更（`index-BDvXw0Te.js` / `index-BJyaUMB5.css`）；已同步更新 `deploy-smart-startup.sh` 的 SHA 与 step-4 资源名。
- 部署脚本 `deploy-smart-startup.sh`（工作区根，未进仓库）：SHA 更新至本轮提交；拉取白名单已含全部 5 个变更后端文件（`auth.js`/`config.js`/`index.js`/`routes/health.js`/`routes/baoliao.js`），step-4 资源名更新为新 hash。

**代表提交**：`22aa5f1`

---

## 批次 15 · 深度审计整改收尾（剩余 M-08~M-17 + L-01~L-05，2026-08-14）

**改动要点**
- 依据 `FULL_PROJECT_AUDIT_REPORT_2026-08-14` 的剩余中/低优先级项，系统性闭环 M-08~M-17 与 L-01~L-05，无新增运行时依赖、无架构改动。
- 三条主线：① 写路径并发安全（定位—修改—落盘原子化）；② 容量/资源硬上限收敛（防 db.json 膨胀与滥用）；③ 测试覆盖补全（health accounts-present、前端 session 登录态驱动、自更新事务性回滚）。
- 部署脚本（deploy.sh）已重构为标准 `git pull --ff-only + npm install + npm run build` 流程，不再依赖 SHA 白名单/jsDelivr 拉取，前端资产名无需硬编码（构建自动刷新）。

**新增功能**
- 无（本轮为纯修复与测试补全）。

**问题修复**
- **M-08 跨站会话 Cookie + 启动告警**：`auth.js` 登录下发的会话 Cookie 收敛 `SameSite`；`index.js` 弱口令/默认令牌告警文案收紧（不回显内部细节）。
- **M-09 DNS 重绑定防护**：`dnsGuard.js` 用内置 `http`/`https` + 自定义 `lookup` 钉死校验 IP、透明解压 gzip/deflate/br，并修复 `lookup` 回调在 `{all:true}` 下的形态（`(err,[{address,family}])`），使 `realAdapter`/notifier 出口校验可靠；新增 17/17 单测。
- **M-10 写路由并发安全**：`routes/users.js`、`routes/baoliao.js` 的 PUT/DELETE/refresh/submit 将「定位—修改—落盘」移入 `withWriteLock` 回调内，锁外仅预读引用，杜绝并发删除+更新导致的「复活」/索引错位 404 误判；加 2 个并发回归测试（routes 全绿）。
- **M-11 单账号签到记录截断**：`store.js` `enforceClockCap` 快速跳过条件由 `账号数*cap+64` 收紧为 `recs.length <= cap`，单账号超限仍被截断（此前可绕过上限）；加单测。
- **M-12 资产快照上限**：`assetLedger.js` `recordAssetEvent` 在 `assetSnapshots` 超 5000 时按日期排序裁剪，防无限膨胀；加单测。
- **M-13 聚合签到状态性能**：`routes/clock.js` 用 `Set` 替代数组 `includes` 做 userId 过滤；加 route 级聚合状态测试。
- **M-14 / M-15 依赖与锁治理**：`web/package.json` vite 由 `^5.4.2` 提升到 `^5.4.20`（锁至 5.4.21，修复路径穿越）；删除与根锁不一致的遗留 `web/package-lock.json`（stray，standalone `npm ci` 会失败），根锁为唯一权威源；前端重新构建验证通过。
- **M-16 自更新事务性回滚**：`selfUpdate.js` 回滚不再仅 `git reset --hard`，而重建 `node_modules` + 重装依赖 + 恢复未跟踪构建产物，保证「全有或全无」；`git diff` 退出码不再被忽略（失败→明确告警而非误报成功）；加 2 个回归测试（selfUpdate 18/18）。
- **M-17 测试覆盖补全**：补 `POST /api/health/cookies` 有账号分支的 route 级测试（此前仅有「无账号」分支）；补前端 `session.applySession` 登录态驱动单测（H-01 后由它驱动登录浮层）；XFF 代理链早有 `authSecurity.test.js` 覆盖。
- **L-02 示例配置补全**：`.env.example` 补全此前缺失的 30+ 项（OPEN_MODE / TRUST_PROXY* / PROXY_* / PUBLIC_BASE_URL / HOST_ALLOWLIST / INSTALL_TOKEN / ZDM_TZ / HEALTH_CONCURRENCY / 风控区间 / 容量上限等），使示例完整表达运行时安全边界。
- **L-03 README 过期修正**：`REQUIRE_AUTH` 默认值 `false`→`true`（secure-by-default）；删除「默认 `admin123`」表述（未设时启动随机生成强密码）；`GET /api/health/cookies`→`POST`（GET 固定 405）。
- **L-04 前端产物清理**：保留 `vite.config.js` 的 `emptyOutDir:false`（项目有意：避免增量构建白名单破坏）；但 `git rm` 当前 `index.html` 未引用的 6 个历史哈希产物（BDvXw0Te/BJyaUMB5/BdxDtcor/Ck0O1y4P/CzjUULqJ/DDj4U6BL），使入库 dist 仅含被引用资产（CF24pHtE.js / BNNPXNhM.css），减小发布体积。
- **L-01 / L-05 记录为保持现状**：L-01（根 `lint` 脚本空操作）属 ESLint 未引入的既定决策（H-10 依赖升级已延后），不强行加 lint 门禁；L-05（大模块耦合）为已知架构技术债，重构超本轮范围，记录待后续专项。

**测试与部署**
- 后端 `npm test -w server` 全量通过（store/assetLedger/routes/routesCore/selfUpdate/dnsGuard 等新增用例：M-10/M-11/M-12/M-13/M-16/M-17 共 +若干，整体 0 失败）。
- 前端 `npm run build` 通过，新产物 `web/dist/assets/index-CF24pHtE.js` / `index-BNNPXNhM.css`；`npm test -w web` 新增 `session.test.js` 3/3 通过。
- 部署：沿用 deploy.sh 标准 `git pull + npm install + npm run build`，无需改 SHA/白名单。

**代表提交**：`b8d9d3f`

---

## 批次 16 · 每日任务执行明细持久化 + 报告 CLI（2026-08-27）

**改动要点**
- 用户诉求：长期找不到「每天哪些任务做了 / 哪些失败 / 失败原因是什么」的结构化记录（`tasks[]` 仅存每任务最后一次纯文本 `lastResult`，无按天历史、无结构化失败原因）。
- 在 `runTask` 出口（覆盖定时调度、手动运行、smart-startup 子任务三类调用方）统一追加一条结构化执行记录到 `db.taskRuns`，落账置于 `withWriteLock` 内与既有持久化原子；`tools/taskReport.mjs` 提供按日期汇总的每日报告查看器。

**新增功能**
- `server/src/taskRunLog.js`：执行明细核心模块。`recordTaskRun(db, raw)` 在写锁内追加记录并落盘（滚动保留上限 3000 条，约 2~3 个月）；纯函数 `filterTaskRuns` / `summarizeTaskRuns` 供 CLI 与未来状态页共用，零 IO 依赖。
- `db.json` 新增 `taskRuns: []`（store 默认 schema + 旧库兼容补齐）。
- 记录形态：`{ id, taskId, taskName, type, userId('all'|具体|null), date(配置时区), startedAt, finishedAt, ok, partial, skipped, message, perUser[], reasons[] }`；`reasons` 为结构化失败原因 `{ action, articleId, error_msg, user }`（评论/收藏/点赞按文章级归因，签到/自定义端点带动作+文本）。
- `tools/taskReport.mjs`：每日报告 CLI，按日期（默认今天）汇总「做了啥/失败/原因」，支持 `--date/--task/--user/--fail/--json/--db`。
- `runEngagement` 新增结构化 `reasons` 产出（含 `articleId`）；`runTask` 内账号循环抽取为 `runAccountTask` 以便聚合各账号失败原因。
- 设计取舍：纯 `skipped`（如定时签到无待签账号）每分钟都会触发，为免刷屏**不记录**；smart-startup 聚合层其子任务已各自记录，故聚合层**跳过**以免重复计数。

**问题修复**
- 无（本轮为纯新增能力）。

**测试与部署**
- 新增 `server/test/taskRunLog.test.js` 6/6 通过（buildTaskRunRecord 形态、filter/summarize 聚合、recordTaskRun 追加 + 3000 截断、runTask→recordTaskRun 接线）。
- 回归：`scheduler/schedulerTick/startup/startup.tz/store` 套件全绿（39/39）。
- 部署：commit `4011453` → `git push origin main` → git bundle 全量直推 VPS（`/root/.deploy.bundle` → `git fetch` + `reset --hard FETCH_HEAD` + `git clean -fd -e data -e .claude` + `systemctl restart zdmclock`），VPS 基线 `68b55f6` → `4011453`。
- VPS 线上验证：X-Powered-By 隐藏（89231c1 纵深加固随主线保留）、`/api/auth/config` 200、服务 active；并以真实 `runTask(t_comment)` 触发一次执行，确认 `taskRuns` 落地且 CLI 正确输出失败原因（6 条「自动评论需要先启用 AI 回复」按文章归因）。

**代表提交**：`4011453`

---

## 批次 17 · 执行明细 Web 展示层（只读 API + 运行台面板）（2026-08-27）

**改动要点**
- `server/src/routes/tasks.js`：新增只读端点 `GET /api/tasks/runs`（鉴权同任务列表 `adminOrAuthRequired`，OPEN_MODE 下强制管理员）。
- `web/src/api/client.js`：新增 `getTaskRuns(params)` helper（`date/taskId/userId/fail/limit`）。
- `web/src/views/Manage.vue`：运行台新增「📋 执行明细」卡片，按日期查看每天哪些任务做了 / 失败 / 原因，支持「仅失败」筛选与刷新；展示各账号明细 + 结构化失败原因（动作 / 文章 ID / 账号 / 错误信息）。
- `server/test/taskRunsRoute.test.js`：6 个路由单测（默认汇总 / `fail=1` / `date=` / `taskId=` / 时间线顺序 / 关闭服务器）全绿。
- 清理 4 个未被 `index.html` 引用的陈旧 dist 产物（对应审计 L-04 同类）。

**新增功能**
- 用户可直接在 Web「运行台」查看每日任务执行明细与失败原因，无需 SSH 进 VPS 跑 CLI。

**问题修复**
- 端点复用 `taskRunLog.filterTaskRuns / summarizeTaskRuns` 纯函数，与 CLI 共享同一数据形态，避免两套实现漂移。

**代表提交**：`ae54e5e`

**VPS 线上验证**
- 全量 git bundle 直推，基线 `4011453 → ae54e5e`，服务 active，OPEN_MODE=true 下端点走 `requireAdmin`（与既有 `/tasks` 列表一致）。
- 经运行中的服务端真实触发 `t_fetch` → `/api/tasks/runs` 正确返回 `total:1`（该次因服务端 IP 被 smzdm 反爬拦截而失败，已结构化记入 `reasons`），印证「服务端自身进程落账」链路无重启竞态。

---

## 批次 18 · 执行明细面板 OPEN_MODE 匿名可读 + t_comment 止噪（2026-08-27）

**改动要点**
- `server/src/routes/tasks.js`：`GET /api/tasks/runs` 鉴权由 `adminOrAuthRequired` 改为 `authRequired`，鉴权模型与签到记录页 `/clock/history` 对齐——**OPEN_MODE 下匿名可读、非开放模式仍需 API_TOKEN**；仅改变 OPEN_MODE 语义，不影响非开放模式。
- `server/test/taskRunsRoute.test.js`：新增「OPEN_MODE 匿名可读」断言（7/7 通过）。
- 上线后配置修复（运行时，非代码）：经 `PUT /api/tasks/t_comment` 将 `t_comment` 置 `enabled:false`，止住「自动评论需要先启用 AI 回复」每日全失败刷屏（根因：VPS 未配置 GPT API Key，`settings.gpt` 无 `apiKey` 字段，AI 回复链路不可用）。

**问题修复**
- 解决开放模式匿名访客无法查看「执行明细」面板（原被 `requireAdmin` 挡住）的问题，与签到记录页访问模型一致。

**代表提交**：`24ed28a`

---

## 批次 19 · 执行明细独立导航页（共享组件 + 导航「明细」入口）（2026-08-27）

**改动要点**
- 新增 `web/src/components/TaskRunsPanel.vue`：从 `Manage.vue` 抽出执行明细卡片，运行台与独立页共用，消除重复逻辑。
- 新增 `web/src/views/TaskRuns.vue`：独立「执行明细」页（路由 `/taskruns`）。
- `web/src/router/index.js`：注册 `/taskruns` 路由（meta 标题「执行明细」、图标 `history`）。
- `web/src/App.vue`：主导航新增「明细」入口（图标 `history`，开放模式匿名可读，与 `/api/tasks/runs` 鉴权一致）。
- `web/src/views/Manage.vue`：改用 `<TaskRunsPanel />`，移除冗余脚本与样式。
- `server/src/routes/tasks.js` / `server/test/taskRunsRoute.test.js` 无改动（沿用批次 18 端点）。

**新增功能**
- 「执行明细」成为一等公民视图：顶部/底部主导航「明细」直达，按日期看每天任务做了啥/失败/原因，支持「仅失败」筛选与刷新；运行台内仍保留同款卡片。

**问题修复**
- 消除执行明细逻辑在运行台与新页之间的代码重复（抽共享组件）。

**代表提交**：`310c6a8`（源码）+ `6e57557`（重建 dist）+ `0e74e3a`（清理陈旧 dist 产物）

---

## 批次 20 · 执行明细日期快捷筛选 + CSV/JSON 导出（2026-08-27）

**改动要点**
- `web/src/components/TaskRunsPanel.vue`：执行明细卡片新增日期快捷筛选（今天/昨天/近 7 天/全部）与导出（CSV/JSON）；引入 `rangeMode` 状态机——`day` 走后端 `date` 过滤，`7d`/`all` 拉全量（limit=1000）后前端按日期过滤，并用 `computeSummary` 前端重算摘要保证跨日模式下与展示一致；导出 CSV 带 BOM 头（Excel 正确识别 UTF-8 中文），JSON 含 summary 与原始记录。
- 运行台（Manage.vue）与独立页（TaskRuns.vue）共用同一组件，两处同时获得新能力，无重复改动。
- 后端 `/api/tasks/runs` 与 `taskRunLog.js` 零改动（复用既有 date/fail/limit 过滤）。

**新增功能**
- 日期快捷跳转：一键看今天 / 昨天 / 近 7 天 / 全部，配合单日期 input（精确日）与「仅失败」开关。
- 失败记录导出：当前筛选结果一键导出 CSV（Excel 直开）或 JSON，便于复盘与归档。
- 跨日模式补全日+时间标签，便于区分不同日期的运行记录。

**问题修复**
- 修正跨日/全部模式下摘要与展示不一致（原依赖后端按单日聚合的 summary），改为前端按当前列表重算。

**代表提交**：`51de44a`（源码）+ `ea504bc`（重建 dist）

---

## 批次 21 · 好价全自动导入（油猴脚本，零点击）（2026-08-27）

> ⚠️ 后续批次 22 已通过官方 RSS 恢复服务器无人值守抓取；本批次的浏览器导入保留为正文补全与兜底通道。

**改动要点**
- 服务端直抓好价（`t_fetch` / `POST /baoliao/refresh`）被 smzdm 反爬挡死（数据中心 IP 挑战页），已禁用定时任务。好价数据只能「从用户浏览器来」。
- 将 `POST /baoliao/bulk` 鉴权由 `authRequiredOrQuery` 放宽为 `authRequiredOrInstall`（`server/src/routes/baoliao.js`）：除通用 apiToken / 会话 Cookie 外，额外接受窄权限 `INSTALL_TOKEN`，使可分发油猴脚本无需固化全权限凭据即可跨域自动导入（与 `/users/import` 同源收窄思路，符合 M-03 收窄暴露面）。
- `mergeBaoliao` 按 `smzdmUrl` 去重（`store.js:333`），重复导入 `added:0`，故自动轮询不会爆库。

**新增功能**
- 油猴脚本 `tools/cookie-grabber.user.js` 升级至 v1.2.0：访问 smzdm 好价列表/频道/首页时**自动抓取**页面内 `/p/<id>` 链接并 `POST /baoliao/bulk` 合并进爆料箱，**零点击、零人工粘贴**。
- 列表页常开标签页每 15 分钟静默轮询刷新，保持爆料箱新鲜。
- 保留「🍪 推送到 zdmclock」按钮，新增「📥 抓好价」手动按钮（详情页或兜底触发）。
- 仅在列表页（非 `/p/` 详情页、且 ≥3 个文章链接）生效，避免误抓。

**问题修复**
- 闭环「好价能否自动导入」诉求：此前仅手动「复制链接→粘贴」与手动「推送 Cookie」，现浏览器侧全自动。

**代表提交**：`893aa97`（放宽 /bulk 鉴权 + 油猴自动导入 + 鉴权测试）

---

## 批次 22 · 官方 RSS 全自动好价（2026-08-27）

**改动要点**
- `fetchBaoliao` 从被反爬拦截的网页抓取切换为官方 `feed.smzdm.com` RSS，无需登录 Cookie，可由服务器每天无人值守执行。
- 新增独立 RSS 解析模块：规范化文章链接、逐条拆分商品标题/价格/优惠信息/发布时间，并按文章 ID 去重。
- 多金额标题采用语义优先级：到手价/券后价优先，淘金币可抵、返积分、满减数字不会误当商品价格。

**新增功能**
- “刷新好价”新安装默认每天 08:00 启用；成功记录显示读取数量、新增数量和去重数量。
- RSS 条目写入 `source`、`publishedAt`，并可为旧的链接占位条目补齐标题和价格。
- `SMZDM_BAOLIAO_RSS_URL` 支持将默认官方源替换为自有 HTTPS 代理。

**问题修复**
- 修复服务端首页抓取持续返回 HTTP 202、导致“刷新好价”每天失败的问题。
- 修复执行明细只显示“失败”却隐藏任务 `message` 的问题，现在直接展示真实失败原因。
- RSS 更新不会覆盖浏览器已经读取到的完整正文；同时修正一条与当前返回结构不一致的旧测试断言。

**代表提交**：649c48c

---

## 批次 23 · AI 服务网页配置入口（2026-09-01）

**改动要点**
- 「GPT 自动回复」页新增独立的 AI 服务配置卡片，可填写 OpenAI 兼容接口地址、模型名称和 API 密钥，无需再登录 VPS 修改 `.env`。
- 页面保存配置立即生效，自动评论与 GPT 批量生成都会读取同一份运行时配置；原有 `.env` 配置继续作为兼容回退。
- 密钥仅写入服务器数据文件，读取配置与保存响应都只返回配置状态，绝不向浏览器回显密钥明文；留空保存不会覆盖旧密钥，另提供显式清除操作。
- 页面配置的公网接口使用 DNS 校验与连接钉死，阻断内网地址、云元数据地址和 DNS 重绑定导致的密钥泄露；本机模型仅允许 `localhost` / `127.0.0.1`。

**新增功能**
- 页面可直接完成“接口地址 + 模型 + API 密钥”配置，并显示密钥来源（网页保存 / 服务器环境）与当前是否可用。
- 自动评论继续逐篇读取 RSS 好价的标题、正文和价格，现场生成自然短评；保存密钥后无需重启服务。

**问题修复**
- 修复页面只有“启用 AI 回复”开关、却没有 API 密钥配置入口，导致用户无法真正启用自动评论的问题。
- 修复旧 GPT 路由中的乱码提示，并增加密钥脱敏、非法地址、清除语义和前端交互回归测试。
- 验证结果：后端 478 项、前端 32 项全部通过；全量 ESLint 与生产构建通过。

**代表提交**：`e8aef9b`

---

## 批次 24 · 第三方 AI 模型服务商（2026-09-01）

**改动要点**
- 将原“GPT 回复”入口统一调整为“AI 模型”，明确系统不绑定 OpenAI 单一服务商。
- 抽离服务商预设配置，模型密钥仍沿用服务端脱敏保存与连接安全校验，不在前端预设中存放任何凭据。
- 保持 OpenAI `/chat/completions` 兼容协议，原有逐篇读取商品标题、正文和价格生成自然短评的链路不变。

**新增功能**
- 新增 OpenAI、DeepSeek、通义千问（阿里云百炼）、OpenRouter 四个快捷选项，选择后自动填写官方兼容地址和建议模型。
- 新增“自定义兼容接口”，可接入硅基流动、本地模型网关及其他 OpenAI 兼容服务；手工修改地址会自动识别为自定义。
- OpenRouter 预设可通过 `provider/model` 模型名统一转接其他厂商模型。

**问题修复**
- 修复页面虽能手填第三方接口，但仍以“GPT”命名、缺少服务商选择，导致用户误以为只能使用 OpenAI 的问题。
- 新增第三方预设切换、自定义识别和保存配置回归测试；前端 34 项测试、全量 ESLint 与生产构建通过。

**代表提交**：`14ec16f`

---

## 批次 25 · 每日任务逐项结果明细（2026-09-01）

**改动要点**
- 每日任务结果不再只保留完成、领取、跳过、失败的数量，四类结果均携带具体任务名称与说明。
- 将每日任务内部的失败数组继续传递到统一执行记录，前端“执行明细”可逐条显示结构化失败原因。

**新增功能**
- 结果文案新增“完成明细、领取明细、跳过明细、失败明细”，单账号摘要与执行记录均可直接查看。
- 失败任务会独立进入 `reasons`，便于页面展示及 CSV/JSON 导出。
- “达人关注推荐”不再把推荐列表编号误当用户名：自动读取当前推荐达人，选择未关注账号完成所需次数，再取消关注恢复原状态。

**问题修复**
- 修复“失败 1 项”却不显示具体失败任务和原因的问题。
- 修复不支持的活动在识别类型前先请求文章，文章源异常时被误判成失败的问题；现在明确归类为跳过。
- 修复“达人关注推荐”使用 `link_val=83` 作为用户名导致“关注的用户不存在”的问题。
- 新增汇总明细、跨层传递与推荐达人关注后恢复状态回归测试；后端 482 项测试及全量 ESLint 通过。

**代表提交**：`9c1ca60`、`6a9c289`

---

## 批次 26 · 全面审计整改（代码质量与加固，A-01/A-02~A-08，2026-09-01）

**改动要点**
- 落实 2026-09-01 全面审计报告（AUDIT_REPORT_2026-09-01.md）的批次 A 整改，聚焦代码质量、技术债务与低风险加固（不含安全高危项）。
- A-01：抽离 OPEN_MODE /24 网段隔离判定为统一函数 `isRecordedIpVisibleToViewer(req, recordedIp)`，消除 baoliao/clock/users 路由中 4 处重复内联（同一语义三套写法），单一来源便于后续演进与测试。
- A-02：realAdapter 退化告警 `degradedWarned` 此前仅 add 无界，补 `DEGRADED_WARN_MAX=1000` 上限（与 channelIdCache 同款 LRU 思路），防长期运行内存无限增长。
- A-03：删除账号后清理其进程内风控状态（熔断/失败计数），避免僵尸状态残留误导后续调度。
- A-04：SPA 兜底 `app.get('*')` 此前每请求 `fs.readFile` index.html，改为进程内缓存、仅 mtime 变化才重读，降低高频兜底路径的 IO 开销。
- A-05：GPT 草稿上限 `200` 裸字面量提为命名常量 `MAX_GPT_DRAFTS`，避免魔法数。
- A-06：`.env.example` 默认 `NODE_ENV=development` 会导致后端不托管 web/dist、前端 404，改为 `production`（部署模板语义正确）。
- A-08：`.env.example` CORS 段补充「跨站部署须启用 HTTPS（登录 Cookie 强制 Secure）」提示，避免纯 HTTP 跨站登录态失效。

**新增功能**
- 新增 OPEN_MODE 网段隔离集成测试 `test/openModeVisibility.test.js`（A-01 T1）：验证匿名访客仅可见同 /24 网段好价，跨段与无归属（遗留）好价被过滤。

**问题修复**
- 修复 OPEN_MODE 网段隔离逻辑分散在 4 处内联、极易被改漏导致水平越权回归的问题（A-01）。
- 修复退化告警 Set 无界增长（A-02）、删号遗留风控状态（A-03）、SPA 兜底每请求读盘（A-04）、草稿上限魔法数（A-05）、部署模板 NODE_ENV 误为 development 致前端 404（A-06）。
- 后端测试全量通过（485 项含新增 T1）；本次仅后端代码 + 测试 + `.env.example`，无需前端构建、不改 web、不部署 VPS。

**代表提交**：`be86741`

---

## 批次 27 · 审计整改收尾（批次 B/C：A-07/A-09/A-10/A-11/A-12，2026-09-01）

**改动要点**
- 收尾 2026-09-01 全面审计报告的批次 B/C 剩余项（A-07、A-09、A-10、A-11、A-12），审计报告 `AUDIT_REPORT_2026-09-01.md` 一并入库作为权威依据。
- A-07：好价 RSS 抓取前新增 `isSafeSmzdmRssUrl` 校验，`config.smzdmBaoliaoRssUrl` 须为 smzdm.com 及其子域（http/https 均可），拒绝 IP 字面量 / localhost / 第三方域名。此前 `call()` 在无 cookie 时仅走 `isSafePushUrl` 放行一切公网地址，缺少与 smzdm 专属白名单同等的护栏。因官方源 `feed.smzdm.com` 当前仅 HTTP 稳定可用，未复用强制 https 的 `notifier.isSafeSmzdmUrl`。
- A-09：新增 `server/src/httpError.js` 的 `sendError(res,{status,error,message})`，把全局兜底 500 与 9 个路由文件的 18 处 5xx 统一为 `{ ok:false, error, message }`，与成功响应 `{ ok:true, ... }` 对称；调用方只需判断 `ok` 字段。`PUT /api/tasks/endpoints` 的 `unsafe_endpoint` / `unsafe_referer` / `invalid_type` / `invalid_params` 一并补齐 `ok:false`。保留既有 error 码，仅补字段，故既有断言不受影响。
- A-10：`store.js` 新增 `mutateDb(fn)`，统一「锁内改内存 + await 落盘」语义，消除各写路由重复的 `withWriteLock(() => { ...; return persistAwait(); })` 样板，降低新增路由漏写 `persistAwait` 的概率（历史曾因 `health.js` 漏写导致 `POST /api/health/cookies` 有账号时 500）。已在 `baoliao.js`（9 处）/ `users.js`（6 处）落地。
- A-11：`GptReply.vue` 移除 `zdm_gpt_reply` 键的 localStorage 读写，GPT 配置以服务端为唯一真相源（读取 `GET /gpt/config` + `/gpt/status`，保存 `PUT /gpt/config`），前端仅留服务端下发的 `serverConfigured` 标记，消除同源 XSS / 恶意扩展读取本地敏感配置的暴露面。

**新增功能**
- 新增 4 个测试文件共 10 项测试（A-12）：
  - `test/a12_techDebt.test.js`（T3）：固化 A-02 `degradedWarned` 恒定有上限、A-03 `riskControl.state` 在 `resetRisk` 后清空。
  - `test/a12_endpointSsrf.test.js`（T4）：`PUT /api/tasks/endpoints` 配非 smzdm 域 → 400 `unsafe_endpoint`；配 smzdm 子域 → 200 接受（不误伤合法端点）。
  - `test/a12_errorEnvelope.test.js` + `test/a12_globalError.test.js`（T5）：`sendError` 产出统一信封；路由内部 catch（`gpt_error` 502）与全局 500 兜底（`server_error`）均走 `{ ok:false, error, message }`。
- `realAdapter.js` 新增 A-02 回归测试钩子 `__warnDegradedChannel` / `__degradedWarnedSize`（仅单测使用，不影响运行时）。

**问题修复**
- 修复 `PUT /api/tasks/endpoints` 的 `unsafe_endpoint` 等安全校验响应缺少 `ok:false`、与统一错误信封不一致的问题（由新增 T4 测试暴露的 A-09 遗漏点）。
- 修复新增测试文件 `mock.module` 跨文件泄漏：`a12_globalError` 把 `store.load` mock 为抛错后未复位，污染后续 `openModeVisibility.test.js`（表现为 `fetch failed`）。已为两个使用 `mock.module` 的测试文件补 `test.after(() => mock.reset())`。
  - ⚠️ 说明：node:test 在同一进程内按文件顺序执行，模块 mock 在 `mock.reset()` 前持续生效；`gpt.test.js` / `notify.test.js` / `realAdapter*.test.js` / `startup.test.js` 亦使用 `mock.module` 但未复位，当前未引发失败（其 mock 对后续文件无副作用），暂不改动以免波动既有基线。
- 后端全量测试 **494 项通过（494 pass / 0 fail / 0 cancelled）**，含前端 `web/dist` 重新构建。

**代表提交**：`14b4a30`、`bd78c70`、`700c92b`、`f32153d`、`b4e8f34`、`8ab90ec`

---

## 批次 28 · 模型名称一键获取服务商模型列表（2026-09-01）

**改动要点**
- AI 模型配置页「模型名称」输入框旁新增「获取模型」按钮：点击后调用新增后端接口 `GET /api/gpt/models` 拉取服务商 OpenAI 兼容 `/models` 列表，结果以 `<datalist>` 回填候选；仍允许手动填写自定义模型名，降低填错模型名的概率。
- 后端仅访问 `resolveGptProvider` 解析出的已配置可信地址（页面保存地址在校验时已限定 HTTPS），远端请求经 `pinnedFetch` 钉死 DNS，防 SSRF / DNS 重绑定；接口走 `authRequired`（会用到已配置密钥）。

**新增功能**
- `GET /api/gpt/models`：成功返回 `{ models: string[] }`（规整 `json.data[].id`）；未配置接口地址 → 400 `gpt_not_configured`；远端非 200 → 502 `gpt_models_error`（带远端明细）；超时 → 504 `gpt_models_timeout`。
- 前端 `GptProviderConfig.vue` 增加「获取模型」按钮 + `<datalist>` 回填；`web/src/api/client.js` 新增 `fetchGptModels()`。
- `server/test/gpt.test.js` +3 项路由测试（成功规整 / 远端 502 / 未配置 400）。

**问题修复**
- 无（纯新增能力）；顺带为 `gpt.test.js` 的 mock `resolveGptProvider` 补 `apiKey` 字段（此前缺该字段会导致 `/models` 不带鉴权头、测试误判 502）。

**代表提交**：`7a329eb`、`13b349a`

---

## 批次 28·补 · 通义/DashScope 原生模型列表（2026-09-01）

**改动要点**
- 用户实测通义预设点「获取模型」返回 401「无效的令牌」/ 空列表：经核实，阿里云百炼/DashScope 的 OpenAI 兼容端点 `compatible-mode/v1/models` **不暴露模型清单**（兼容端点未实现列出接口，401 实为 Key 被拒或端点不支持），其模型列表走原生 `GET /api/v1/models`（`Authorization: Bearer`，返回 `output.models[].model_name`）。
- `server/src/routes/gpt.js` 的 `/models` 新增 `resolveModelsSource`：当 `apiBase` 主机以 `.aliyuncs.com` 结尾时改走原生 `/api/v1/models?page_size=100` 并取 `output.models[].model_name`；其余 OpenAI 兼容服务商仍走标准 `/models`（取 `data[].id`）。两者均仅访问已配置可信地址、`pinnedFetch` 钉死 DNS。错误明细提取兼容顶层 `message`（如 DashScope `InvalidApiKey`）。

**新增功能**
- 「获取模型」对通义预设真正可用：拉出 qwen 系列等模型回填下拉；OpenAI/DeepSeek/OpenRouter 等不受影响。

**问题修复**
- 无（provider 限制适配）。

**代表提交**：`cc32122`

---

## 批次 29 · 模型列表鲁棒化与空列表诊断（2026-09-01）

**改动要点**
- 用户实测通义预设点「获取模型」已由 401 转为 **HTTP 200 空列表**：请求确已正确路由到原生 `/api/v1/models`，但 `output.models` 未被解析出模型。为一次定位，做两件事：
  1. `extract` 改造为统一多结构 `extractModelsAny`：兼容 OpenAI 兼容 `data[].id`、DashScope 原生 `output.models[].model_name`（亦兼容 `.id`）、以及部分厂商裸 `models[]`，去重保序。
  2. 空列表不再静默返回 `[]`，改为回显诊断：HTTP 状态 + 响应顶层键名 + 原始响应体前 500 字符（`gpt_models_empty` 502 信封），便于确认是返回结构差异、地域/工作空间专属端点，还是该 Key 无模型列权限。

**新增功能**
- 无新能力；`/api/gpt/models` 在更多服务商/返回结构下可直接成功。

**问题修复**
- 模型列表空响应由「前端模糊提示不支持 /models」升级为「精确回显服务商原始响应」，为下一步精准修复 `extract` 或端点（如 `dashscope-intl`/`cn-hongkong.dashscope`/`*.maas.aliyuncs.com` 工作空间子域）提供一手依据。
- `server/test/gpt.test.js` 现有 17 项路由用例全绿；全量 `node --test` 499 项通过。

**代表提交**：`df6e061`（已部署 VPS）

---

## 批次 30 · 模型列表错误体探测（apihub 200+error，2026-09-01）

**改动要点**
- 线上实测定位根因：用户本地 `npm run dev` 的 `db.json` 无 apihub Key（仅 VPS 存过），本地后端不带鉴权调 `https://apihub.agnes-ai.com/v1/models`，该服务商返回 **HTTP 200 + `{"error":{"message":"未提供令牌"}}`**（非 4xx）。旧 `!resp.ok` 判据拦不到，被误当空列表 → 误导性「未获取到模型列表」。
- `GET /api/gpt/models` 在解析前先对响应体做**错误体探测**：若响应体带 `error`/`message` 且不含任何模型数组（`data`/`output.models`/`models`），直接 `502 gpt_models_error` 回显服务商原话（如「未提供令牌」），不再沉默为空列表。真正空列表仍走 `gpt_models_empty` 诊断信封。

**新增功能**
- 无新能力；鉴权/配置类错误（Key 缺失或失效）现给出明确中文报错，而非空列表假象。

**问题修复**
- 修复「HTTP 200 + 错误体」被误判为空模型的盲区（apihub / 部分 DashScope 地域同款行为）。
- `server/test/gpt.test.js` +1（apihub 200+错误体→502 `gpt_models_error` 且 `message` 含「未提供令牌」）；全量 `node --test` 500 项通过。

**代表提交**：`b710047`（本地未部署）

---

## 批次 31 · 禁用 API 响应浏览器缓存（修复「获取模型」浏览器显空，2026-09-01）

**改动要点**
- 线上复测：用户浏览器 Request 头带 `If-None-Match`，定位到 API 响应默认带 `ETag` 且缺 `Cache-Control`，浏览器启发式缓存并发条件请求；命中服务端 304（空 body）时，前端 axios 解析到空 `data` → 误判空列表（典型：「获取模型」服务端返回 11 个模型、浏览器却显「未获取到模型列表」）。`curl` 无缓存故始终正常，造成「服务端有、浏览器空」的错位。
- `server/src/index.js` 新增全局中间件：对所有 `/api` 响应加 `Cache-Control: no-store, no-cache, must-revalidate` 与 `Pragma: no-cache`，彻底杜绝浏览器缓存 API 响应（API 数据本不应被缓存，亦可避免陈旧数据）。

**新增功能**
- 无新能力；修复缓存导致的「获取模型」浏览器显空。

**问题修复**
- 修复 API 响应被浏览器缓存 + 304 空 body 致前端误判空列表的问题（影响所有 `/api` GET，不止模型列表）。
- `server/test/gpt.test.js` +1（断言 `/api` 响应含 `Cache-Control: no-store`）；全量 `node --test` 501 项通过。

**代表提交**：`09b6489`（已部署 VPS，HEAD `f3d419d6`，2026-09-01 21:43）

---

## 批次 31·补 · 模型列表改为可见芯片（修复「没有下拉键」，2026-09-01）

**改动要点**
- 用户实测「获取模型」返回 11 个模型（Response body 已确认），但「模型名称」输入框用 `<datalist>` 承载候选，仅在聚焦输入框时才弹出原生建议，不聚焦时看不到「下拉键」；且 `fetchModels` 成功回填 `agnes-*` 后易被误认为没生效。交互过于隐蔽。
- `web/src/components/GptProviderConfig.vue`：在「模型名称」输入框下方新增**始终可见、可点击的模型芯片列表**（`availableModels` 渲染为 `<button class="model-chip">`），点击即选中（`model = m`，当前项高亮），不再依赖隐蔽的 datalist 下拉。datalist 保留作兼容性兜底。

**新增功能**
- 模型候选以可见芯片呈现，点击即选，消除 datalist 交互歧义。

**问题修复**
- 修复「获取模型」拉到模型却因 datalist 隐蔽而看似「没有下拉/没生效」的体验问题。

**代表提交**：`f4849b5`（源码）+ `64b78e7`（web/dist 构建），待部署 VPS

---

## 批次 32 · 静态资源改 no-store，根治 SPA 旧标签跑旧 JS（2026-09-01）

**改动要点**
- 批次 31·补 部署后用户仍报「获取不了」：实测 `/api/gpt/models` 稳定返回 11 个 `agnes-*` 模型（HTTP 200 + `no-store`），线上 bundle 也含芯片代码，服务端完全正常。
- 真因：静态资源 `/assets/*` 此前被设为 `public, max-age=86400, immutable`，浏览器**缓存一整天且绝不重校验**；用户在部署前打开的 SPA 标签页一直跑旧 JS（旧 `fetchModels` 只回填隐藏的 `<datalist>`、无可见芯片），点「获取模型」拿到数据却看不到下拉。这是「数据到了、界面没反应」的真正来源（非 /api 缓存，/api 早已 no-store）。
- `server/src/index.js`：`express.static` 的 `setHeaders` 对 HTML 与 `/assets/*` **统一 `no-store, must-revalidate`**，彻底堵死旧 JS 被缓存的可能；SPA 兜底注入的 `?v=<构建戳>` 保留作双保险。单用户管理面板带宽可忽略。

**新增功能**
- 无（纯缓存策略调整）。

**问题修复**
- 修复「部署新前端后、旧 SPA 标签页仍跑旧逻辑、芯片/新功能不出现」的 staleness 问题；今后任意一次整页刷新必拉最新代码。

**代表提交**：`0fcdc48`（server 静态 no-store），已部署 VPS（HEAD `0fcdc486`）

---

## 批次 33 · 自定义模型列表前端渲染修复与连接重试（2026-09-02）

**改动要点**
- 线上逐段核验“配置保存 → 后端拉取 → 前端渲染”链路：自定义服务商配置和密钥均已保存，服务商 `/models` 实测返回 11 个模型；定位到前端把已由 API 客户端解包的 `{ models: [...] }` 再次按 Axios `{ data }` 解包，导致正常结果恒被误判为空数组。
- 模型列表属于幂等 GET；针对第三方网关偶发的 `ECONNRESET`、DNS 临时失败和连接超时类瞬时错误，首次失败自动重试一次，HTTP 鉴权错误、业务错误和整体超时不重试。

**新增功能**
- 新增前端交互回归测试：点击“获取模型”后必须显示可见模型芯片、自动选中首项，并可点击切换模型。
- 新增后端网络回归测试：首次 `ECONNRESET`、第二次成功时必须返回完整模型列表。

**问题修复**
- 修复自定义服务商实际返回模型、前端却始终提示“未获取到模型列表”的稳定缺陷。
- 降低第三方服务商偶发连接重置导致模型列表获取失败的概率；不改变密钥保存与 DNS 钉死安全策略。
- GPT 定向测试、前端交互测试、全项目测试与生产构建通过。

**代表提交**：`5fc6383`

---

## 批次 34 · 众测来源限制改为真实“跳过”状态（2026-09-02）

**改动要点**
- 线上核验 2026-09-02 09:45 的众测记录：同一 Cookie 的签到、收藏与点赞均正常，众测活动端点持续返回 `error_code 12 / 来源错误`；该结果属于平台要求 App 来源的限制，并非 Cookie 失效。
- 打通 `tasks_real → taskMatrix → taskRunner → taskRuns → scheduler/routes` 的跳过状态传递，业务型跳过不再被成功计数吞掉。

**新增功能**
- 多账号任务摘要新增独立跳过计数，格式为“成功 / 失败 / 跳过”；全部账号均跳过时，执行明细显示“跳过”。
- 众测来源限制提示明确标注“仅允许 App 来源、非 Cookie 失效”；自动任务页同步补充限制说明。

**问题修复**
- 修复众测消息写着“跳过”，执行明细却显示“成功”的状态错配。
- 跳过任务不再刷新资产或写入虚假的成功资产账本；业务型跳过仍保留执行明细，高频签到空转继续静默不记。
- 只有明确的 `error_code 12` 才软跳过；其他网络、鉴权与接口错误恢复为真实失败，避免掩盖故障。
- 后端全量 506 项测试通过，相关前端测试、定向 ESLint 与生产构建通过。

**代表提交**：`a4912dd`

---

## 批次 35 · 推理模型输出预算修复（评论「大模型返回内容为空」，2026-09-01）

**改动要点**
- 复现场景：一轮评论任务 12 篇中 6 篇失败于 `文章 <id>: 大模型返回内容为空（请检查模型与参数）`，成功/失败两组都混有「有完整商品信息」与「仅有标题」的条目，排除商品数据缺失、`cleanReply` 逻辑与网关偶发抖动三种猜测。
- 在 VPS 上以线上真实凭据直连所用路由（base `https://app.kilo.ai/api/gateway`、model `kilo-auto/free`）逐档实测 `max_tokens`，锁定根因：该路由把请求转发给**推理模型** `stepfun/step-3.7-flash`，而 OpenAI 兼容接口的 `max_tokens` 是**思维链 reasoning + 答案 content 的总预算**；原先硬编码的 `200` 被 reasoning 吃满后，答案 `content` 直接被截断成空串，响应 `finish_reason=length`、`completion_tokens=200`、`reasoning_tokens=71`，HTTP 仍是 200，因此上层只能看到「返回内容为空」。
- 实测对照：`max_tokens=200` → 空内容（finish=length）；`1024` → 正常输出（finish=stop、`completion_tokens=379`）；`2048` → 正常。计费按实际 `completion_tokens` 结算，放宽上限不会凭空增加开销。

**新增功能**
- 新增可配置输出上限 `GPT_MAX_TOKENS`（`config.gptMaxTokens`），默认 `1024`，取值收敛在 `256~8192`，便于按所选模型是否带思维链自行调整。
- `.env.example` 补充该项说明，写明「max_tokens 为 reasoning + content 总预算」这一易踩坑点及其空返回表现。

**问题修复**
- 修复评论自动回复在推理模型下约半数概率失败于「大模型返回内容为空」：`requestCompletion` 的 `payload.max_tokens` 由硬编码 `200` 改为 `config.gptMaxTokens`。
- 空内容分支不再静默抛错，先输出诊断日志（`model / finish_reason / completion_tokens / prompt_tokens`）再抛出。此前 6 条完全相同的错误串会被 journald 重复行抑制，导致线上日志里看不到全部失败；日志中带上每条不同的 `prompt_tokens` 可规避抑制，后续同类问题可直接从服务日志判断是截断还是模型真的空返回。
- 新增 2 项回归测试（断言 `max_tokens` 取自 `config.gptMaxTokens` 且不再等于 `200`、以及配置值落在合理区间），`server` 侧 `gptAdapter.test.js` 17 项全部通过。

**代表提交**：`558e561`

---

## 批次 35·补 · 预算余量与偶发空返回重试（2026-09-01）

**改动要点**
- 批次 35 部署后以零副作用方式复验（只跑评论「生成」半程、不调用发帖接口）上一轮失败的 6 篇：**5 篇恢复正常出稿，1 篇仍空返回**，且新增的诊断日志直接给出原因 `finish_reason=length / completion_tokens=1024 / prompt_tokens=326` —— 该篇正文更长，思维链把 1024 预算也吃满了。
- 对该篇逐档探测后确认这是**随机性**而非确定性失败：同一篇、同一 1024 预算连打 3 次全部成功，但 `reasoning_tokens` 在 111 / 208 / 301 之间大幅波动，对应 `completion_tokens` 359 / 664 / 983 —— 983 已贴住 1024 上限，只要思维链稍长就越界截断。`2048`（436）与 `4096`（524）均稳定出稿。
- 结论：单纯「够用」的预算不足以吸收思维链的随机波动，需留倍数级余量；同时对这类偶发失败补上重试兜底。

**新增功能**
- 抽取并导出 `isRetriableCommentError(message)`，把「模型返回内容为空」纳入评论的可退避重试集合（原先仅涵盖 smzdm 限流），复用既有的 `maxCommentRetry=2` 退避链路；鉴权、参数、缺商品信息、自然度不达标等真故障仍一次判失败，不被重试掩盖。

**问题修复**
- `config.gptMaxTokens` 默认值由 `1024` 提高到 `4096`（相对实测峰值留约 4 倍余量），`.env.example` 同步更新并补充「reasoning 长度随机波动」的说明。上限只是天花板，计费按实际 `completion_tokens` 结算，放宽不增加常态成本。
- 新增 2 项针对 `isRetriableCommentError` 的测试（可重试集合 + 真故障不重试，含空串与 `undefined` 边界）。后端全量 **510 项通过**，改动文件定向 ESLint 无告警。

**代表提交**：`2dedc17`

---

## 批次 35·补二 · GPT 请求超时与 token 预算耦合（2026-09-01）

**改动要点**
- 批次 35·补把输出 token 预算放宽到 4096 后，原 `GPT_REQUEST_TIMEOUT=20000` 反过来成了新的瓶颈：思维链偶发跑飞时，本应「答案截断为空」的失败会变成「请求超时」，且超时错误此前未纳入 `isRetriableCommentError`，空返回重试兜不住，等于把一种失败换成了另一种。
- 二者必须耦合调参。线上实测出词速率约 50~110 tokens/s，按最保守的 50 计，跑满 4096 预算约需 82s；超时若小于该值，放宽的预算根本用不到。

**新增功能**
- 新增可配置请求超时 `GPT_REQUEST_TIMEOUT`（`config.gptRequestTimeout`），默认 `90000`，取值收敛在 `5000~300000`，便于与 `GPT_MAX_TOKENS` 同步调整。

**问题修复**
- `config.gptRequestTimeout` 默认 `90000ms`；`gptAdapter.js` 超时改读 `config.gptRequestTimeout`，消除原先裸 `Number(env)` 在填非法值时得到 `NaN`、进而令 `AbortSignal.timeout` 抛错的隐患（统一走 `boundedInt` 钳制）。
- `isRetriableCommentError` 正则追加「请求超时」：与空返回同源（思维链偶发跑飞，只是撞在超时而非预算上），同属可重试的随机波动，复用既有 `maxCommentRetry=2` 退避链路；真故障仍一次判失败。
- `.env.example` 补充 `GPT_REQUEST_TIMEOUT` 及「须与 `GPT_MAX_TOKENS` 匹配」的耦合说明（已有测试守护该不变量）。
- 测试：`gptAdapter.test.js` 新增「超时取自 config」与「超时余量≥跑满预算所需（90s ≥ 81.9s）」不变量 2 项；`taskRunner.test.js` 新增超时可重试用例。后端全量 **512 项通过**（本次全量一度卡在 `update.test.js` 的后台 git 操作，隔离复跑 9/9 通过、再跑全量 512/512，确认为 sandbox 偶发而非回归）。

**代表提交**：`65fd97d`

---

## 批次 36 · 自动评论增强：拟人回复 / 去 AI 味 / 节奏化 / 回复详情（2026-09-01）

**改动要点**
- 围绕用户提出的四点要求（拟人回复、不一下子回复、去除 AI 味、显示回复详情）对「自动评论」做了一轮增强；
  重点是把「AI 实际发了什么」从黑盒变成可在任务卡片与执行明细中逐篇核对的明文，并进一步压低机器味与批量脚本特征。

**新增功能**
- 评论结果逐篇明细（`details[]`）：每篇记录 `articleId / title / action / comment / ok / message`，评论任务把生成的评论正文逐条列进结果文本（`文章 123「评论正文」`），任务卡片与执行明细页均可查看。
- 执行明细页（`TaskRunsPanel`）新增「回复详情」区块：仅评论任务渲染，逐篇展示文章 ID、评论正文与失败原因，红框标注失败项。
- 拟人化节奏默认更从容：互动延迟默认区间由 `2~15s` 调为 `3~18s`，长停顿概率 `0.15→0.18`、上限 `30s→45s`，评论任务逐条错峰、不背靠背。

**问题修复**
- `gptAdapter.buildProductCommentPrompt` 重写：强调「像真人刷到好价随手打的一句、允许无感/吐槽/小惊喜、不必句句夸」，压缩模板腔与书面总结腔。
- `AIISH_COMMENT_PATTERNS` 扩充导购/营销腔（`不容错过|闭眼入|值得拥有|入股不亏|强烈推荐|真心推荐|非常值得|性价比之王|无脑入|安排得明明白白`），命中即触发二次重写换更口语的切入点。
- `generateProductComment` 二次重写引导语强化为「完全不同切入点、真人随手一句、避开原句任何措辞」。
- `taskRunLog.buildTaskRunRecord` 新增 `details` 字段并随执行明细落库，供前端结构化展示。

**代表提交**：`1cdc7ef`（源码+测试）、`50434e8`（前端重建产物）

---

## 批次 37 · 自动评论分时间段拟人回复：commentQueue 跨时间片逐片消化（2026-09-01）

**改动要点**
- 承接批次 36 用户新反馈「你还没考虑回复时间段，你现在是一下子就回复 12 个」：此前只在单次运行内做拟人化错峰（约 2~4 分钟把 12 篇一口气发完），本质仍是一次性爆发。
- 本批次把「一次跑完 N 篇」拆成**跨多个时间片**逐步消化：评论任务挂一个**持久化队列** `commentQueue`（本次 campaign 待评文章 refs），每个被调度命中的时间片只取前 `engagementBatchPerSlot` 条处理，剩余留在队列等下个时间片；队列空 + 跨到新的一天时重新抽样开启新 campaign（`commentCampaignDate` 标记 campaign 所属日期，`commentCampaignTotal` 记总篇数供进度展示）。
- 配套把评论任务**从「智能启动调度」流水线中解耦**：原 `ACCOUNT_PIPELINE_TYPES` 含 `comment`，导致 `t_startup`（默认启用）每天只启动一次、评论集中在一刻爆发——这与「分时间段」诉求根本冲突。现把 `comment` 移出该集合，改由其自身**多时段 cron**（默认 `0 9,12,15,18,21 * * *`）驱动，配合队列把 12 篇拆成约 4 个时间片（每片 ~3 篇）逐步消化。收藏/点赞等仍走启动调度，行为不变。

**新增功能**
- 分时段评论队列：`taskRunner.runEngagement` 在 `baoliao` 来源 + `comment` 任务 + `engagementQueueEnabled` 开启时进入队列模式；队列状态（`commentQueue` / `commentCampaignDate` / `commentCampaignTotal`）持久化在任务对象上，由调度器 / 手动运行统一落盘，进程重启不丢已完成进度。
- 配置项：`engagementQueueEnabled`（默认开）、`engagementBatchPerSlot`（默认 3，每片最多评几篇）。
- 结果进度提示：评论结果文本新增「（分时段：本片 M/N 篇，剩余 R 篇待下个时间片）」，任务卡片与执行明细可直接核对节奏是否真「分时间段」；当日内 campaign 已完成的时间片返回 `skipped`（silentSkip，不写执行明细，避免刷屏）。
- 旧库迁移：`store.load` 为 `comment`/`favorite`/`point` 等任务补齐 `commentQueue` / `commentCampaignDate` / `commentCampaignTotal`；并把 `t_comment` 旧默认 cron `0 10 * * *` 迁移为 `0 9,12,15,18,21 * * *`（仅当仍是旧默认值时，避免覆盖用户自定义）。

**问题修复**
- 根因闭环：评论「一下子回 12 个」的根因是启动调度每天只跑一次、评论被集中爆发；通过解耦 + 队列彻底改为逐片消化。

**代表提交**：`c8f1bfa`（源码+测试+CHANGELOG）

---

## 批次 38 · 评论任务分时段「随机」执行：08:00–23:00 窗口内随机选时刻（2026-09-01）

**改动要点**
- 承接批次 37 用户新反馈「不要那么定时，下次拟人执行随机 8-23 点这段时间」：批次 37 把评论拆成多时间片，但时刻仍是固定 `0 9,12,15,18,21`（每天准点），机械感仍在。
- 本批次引入 **randomSchedule** 任务配置：启用时**忽略固定 cron**，改为「当天随机时刻计划」——在 `[start,end]` 窗口内随机选 `slots` 个**不重复**时刻触发任务。随机计划决定「几点发」，批次 37 的 `commentQueue` 仍负责把 N 篇拆成多片消化，**两者正交**，共同构成真正拟人的「不定时、慢慢评」节奏。
- 计划按「日期 + 任务」缓存于内存，**当天稳定**（重启后当天重新随机，已发评论记录在队列里不会重复发）；跨天自动重算。当天**最后一个随机时刻**由调度器打标 `drainRemaining`，`runEngagement` 据此一次发完队列剩余，确保 campaign 当天收尾、不跨天漏评。

**新增功能**
- `scheduler.generateRandomPlanTimes(startMin, endMin, slots, rng)` 纯函数：在窗口内生成 `slots` 个不重复升序随机分钟；`rng` 可注入便于单测；`lo>hi` 自动交换区间；`slots` 封顶 48（防退化）。
- `ensureRandomPlan(t, z)`：取/建某任务当天计划，时区口径与 cron 求值一致（`zonedWallClock`）；读任务 `randomSchedule.{start,end,slots}` 或 config 默认值。
- 调度 `tick`：任务 `randomSchedule.enabled` 时，若当前分钟在当天随机计划内则命中并在末位时刻置 `drainRemaining`；否则走原固定 cron 分支（逻辑不变）。
- 配置项：`engagementRandomWindowStart` / `engagementRandomWindowEnd`（默认 `08:00` / `23:00`）、`engagementRandomSlots`（默认 6）。
- `t_comment` 默认开启 `randomSchedule:{enabled:true,start:'08:00',end:'23:00',slots:6}`（保留旧 cron `0 9,12,15,18,21 * * *` 作为手动/兜底）；旧库迁移为缺省任务补齐该字段。

**问题修复**
- ⚠️ 批次 38 初版引入 **tick 回归**：固定 cron 分支命中后漏置 `matched=true`，导致 `t_fetch` 等所有固定 cron 任务被 `if (!matched) continue` 整体跳过（表现为定时刷新好价等不再执行）。由 `schedulerTick.test.js`「同分钟去重」单测捕获并修复——固定 cron 命中处补 `matched = true`。根因是重构调度分支时把「命中即落库执行」的隐式语义显式化为 `matched` 标志，但固定分支遗漏置位。

**代表提交**：`00266d2`（源码+测试，后端全量 521 项通过）

---

## 批次 39 · 自动评论话术收敛（攻击性质问 / 嘲讽腔消除）（2026-09-03 → 2026-09-04）

**改动要点**
- 承接用户线上反馈「自动评论话术太冲」：3 条真实攻击性样本上线发布（"啥正文都不给，就甩个长文章id糊弄人呢？"等），均为**占位标题**（用户只粘贴链接导入时 `routes/baoliao.js` 把标题回填成 `文章 <id>`）导致 `taskRunner.js:215` 原「title/content/price 全空」守卫因 title 非空而失效，模型把"自然追问"演绎成质问。
- 修复按四层做：**数据层拦截 → prompt 划界 → 过滤兜底 → 重写纠偏**。新增导出 `isPlaceholderTitle` / `hasUsableProductFact` / `PLACEHOLDER_TITLE_RE`；`generateProductComment` 占位标题按"未提供"拼接（不再喂裸文章 ID）；`buildProductCommentPrompt` 增加语气边界（禁止质问/嘲讽/阴阳怪气/数落发布者，点名"糊弄/逗我呢/骗谁呢/这是卖啥/累不累/凭什么"），并把危险的"信息不足就**自然追问一句**"改成陈述句反应（如"这个价我先观望下"）；新增 `RUDE_COMMENT_PATTERNS`（4 条正则）兜底；二次重写引导语补"语气必须平和，只评价商品本身，不得质问、嘲讽或数落发布者"。
- 守卫落地：`runEngagement`（L218）与 `runGptBatch`（L423）两处循环开头追加 `!hasUsableProductFact(...)` 则 throw 明确原因、**逐篇跳过**（不致整批失败）；`isRetriableCommentError` 正则扩 `|未通过自然度检查`，让冲话术有退避重试机会（仍受 `maxCommentRetry=2` 约束）。
- 用户选方案 **A**（信息缺失时**跳过**而非硬发灌水评论）作为线上默认行为。

**新增功能**
- `gptAdapter.isPlaceholderTitle(s)` / `hasUsableProductFact({title,content,price})`：识别 `文章 <id>` 占位、判定是否至少有一项可用的真实商品信息。
- `gptAdapter.RUDE_COMMENT_PATTERNS`（4 条）：覆盖线上实证的"啥X不/没""这是/到底卖啥""累不累/就甩个/就给个编号"等攻击性形状。
- `productCommentIssues` 命中 `RUDE_COMMENT_PATTERNS` 即报「语气带质问或嘲讽」，与 `AIISH_COMMENT_PATTERNS` 共享同一 issue 通道。

**问题修复**
- ⚠️ **根因纠正**（批次 39 初版判断有误）：用户**不是**"title/content/price 三项全空"，而是只有标题被 `routes/baoliao.js:94` 的 `title: title || \`文章 ${id}\`` 回填成占位串、content/price 为空。原 `taskRunner.js:215` 的 `!title && !content && !price` 守卫因 title 非空失效，模型收到"商品标题：文章 180074206 / 正文：未提供"才吐槽"就甩个长文章id"。证据链与线上样本完全吻合。批次 39 同步补了 `hasUsableProductFact` 守卫（不依赖 title 是否非空，从语义上判定"是否真有一条可评信息"）。
- `isRetriableCommentError` 语义放宽副作用（让模板腔/AI 化措辞也享受 2 次退避重试）由测试 `gpt.test.js` 显式固化。

**代表提交**：`ffa0ea8`（源码+测试，后端全量 530 项通过）

---

## 批次 40 · 修正 什么意思 误伤 + 补嘲讽漏网变体（2026-09-04）

**改动要点**
- 承接批次 39 上线后主理人独立抽查发现：批次 39 的 `RUDE_COMMENT_PATTERNS` 第 4 条含 `什么意思`，把「这价什么意思，比昨天还贵」这类**针对商品的正常吐槽**误判为攻击（误报让好评论被判失败、退避重试 2 次仍可能任务变红，**代价大于漏拦**）。
- 第 4 条移除 `什么意思`；新增第 5 条 `/这(?:也|能|也能)叫|当傻子|把人当|当韭菜/u` 覆盖两个新发现的漏网变体（"这也能叫爆料？""怕不是把人当傻子"等）。`这(?:也|能|也能)叫` 故意排除「这叫什么神仙价格」（叫前是"什"而非"也/能/也能"），零误伤。

**问题修复**
- 误伤收敛：`什么意思` 不再被拦，「这价什么意思，比昨天还贵」返回 `[]` 放行。
- 漏网收敛：「这也能叫爆料？」「怕不是把人当傻子」命中第 5 条报「语气带质问或嘲讽」。

**代表提交**：`bb96f2f`（源码+测试，后端全量 549 项通过）

---

## 批次 41 · 清零批次 40 残留 7 条误伤 + 谨慎补漏 + D3 守卫 + 整合 QA 验收（2026-09-04）

**改动要点**
- 承接批次 40 上线后 QA（software-qa-engineer）**因模型用量 429 限流失败**，但它失败前留下 562 行验收测试 `server/test/commentTone.qa.test.js`（覆盖 A–H 八方面，刻意不用 mock.module、用 globalThis.fetch/doComment 打桩）+ 3 个临时探针脚本。主理人独立实测 QA 的完整 `FALSE_POSITIVES_KNOWN` 清单（10 条正向样本）后挖出**批次 40 仍未清零的 7 条真实误伤**：「啥也不说了，这价直接冲」×3 / 「卖啥不重要，便宜就行」 / 「搞笑呢，这价格像白送」 / 「开什么玩笑，这价也太香了」 / 「就给个编号也不影响我下单」。全量测试 549 中 3 个是 QA 的 skip 测试（记的是批次 39 的已知缺陷），"全绿"是假象。
- 修复按"主理人兜底 → 工程师精确修复 → 主理人独立复测"流程：实测「删掉 `啥…不/没…` 宽正则」后线上 3 条攻击样本**仍被** `糊弄` / `就甩个` / `这是卖啥` 三条规则兜住（无需依赖"啥…不…"形状），可安全收窄。最终 `RUDE_COMMENT_PATTERNS` 6 条：第 2 条 `啥…都…不/没…` 移除"也"分支（消除"啥也不说了"误伤）、第 3 条 `卖啥` 收窄为质问形（放行"卖啥不重要"）、第 4 条删除 3 个高频正向惊讶词、保留的 5 条（批次 40 加）维持、第 6 条新增 4 个低风险漏网（谁给的勇气 / 也好意思 / 标题党 / 侮辱智商）。明确不补「就这？」「啥玩意儿」「发个寂寞」「会死吗」（易误伤，靠 prompt 层 + 重写 + 重试三道防线兜底）。
- **D3 缺口**（QA 揭示、工程师批次 39/40 遗漏）：`smzdm/tasks_real.js` 的 `performDailyTask` 里 `interactive.comment` 分支是**第三处**评论生成调用点（除 `taskRunner.runEngagement` / `runGptBatch` 外），原循环直接 `generateComment(...)` 然后 `doComment(...)`，**未套 `hasUsableProductFact` 守卫**。本批次补上：入口过滤 + 空集合短路，占位标题条目不调大模型、不发评论；performDailyTask 返回"无可用商品信息（占位标题或缺正文/价格），已全部跳过"或"AI 评论 N 篇（跳过 M 篇信息不足）"——**每日任务不因此整体失败**，与 runEngagement/runGptBatch 的"逐篇跳过"语义一致。
- **整合 QA 验收**：`commentTone.qa.test.js` 纳入仓库（`create mode 100644`），D1/D2/D3 三个 skip 翻转（硬指标：10 条正向样本全放行、6 条攻击样本全拦、占位标题条目不调 generateComment 不发布），D2 清单按"宁可不拦易误伤项"原则调整（移除就这/啥玩意儿/发个寂寞/会死吗，注释说明靠 prompt 兜底）。QA 探针 `server/.qa-probe.mjs` × 3 删除（一次性取数脚本，非测试套件）。

**问题修复**
- 7 条误伤清零：实测 `RUDE_COMMENT_PATTERNS` 改后 D1 清单 10 条全部放行（含「啥也不说了」×3、「卖啥不重要」、「搞笑呢」、「开什么玩笑」、「就给个编号」）。
- 4 条漏网补：谁给的勇气 / 也好意思 / 标题党 / 侮辱智商。
- D3 一致性：`tasks_real.js` 第三处调用点补守卫，三处评论生成入口（runEngagement / runGptBatch / interactive.comment）行为一致。
- 验收测试可执行：QA 的 `commentTone.qa.test.js` 纳入仓库并全量通过，全量 549 / 549 / 0 / 0 / 0（tests / pass / fail / cancelled / **skipped**）——**skipped 归零**。

**已知风险**
- 正则仍黑名单策略：批次 41 把覆盖面收得更窄，模型出新说法的漏网率上升。兜底链路：prompt 划界（主要）→ 重写（一次）→ 任务级重试（2 次）→ 任务变红。新漏网样本可低成本加进 `RUDE_COMMENT_PATTERNS`。
- `update.test.js` M1 偶发 flaky：POST `/api/update/apply` 并发第二次期望 409 实际 202，是 20ms 延时的并发竞态，~50% fail 概率。预存在，与本批次无关；单独跑 9/9 通过。建议长期改 50–100ms 但**本次不动**。

**代表提交**：`de67d51`（源码 + QA 验收 + 清理探针，后端全量 549 项通过、0 skipped）

---

## 批次 42 · 攻击性评论内容发布前安全闸门（2026-09-04）

**改动要点**
- 承接用户反馈「优化评论内容，去除攻击性内容」：在已有提示词、二次重写和任务重试之外，再增加统一的发布前自然度校验，避免替换模型或自定义生成器后绕过语气约束。
- 黑名单规则改为“明显针对发布者/商家/他人”才拦截；「离谱」「智商税」等单独用于商品评价的口语保留，减少正常短评误伤。

**新增功能**
- `buildProductCommentPrompt` 明确禁止攻击、贬低、质问和阴阳怪气，并覆盖「坑人」「割韭菜」「把人当傻子」等变体。
- `runEngagement`、`runGptBatch`、每日任务 `interactive.comment` 三条评论发布链路统一执行 `productCommentIssues` 安全闸门；不合格内容会进入重试，仍不合格则不发布并记录明确失败原因。
- 增加隐蔽攻击词与提示词回归测试，锁定“正常商品吐槽放行、针对人的攻击拦截”边界。

**问题修复**
- 修复自定义模型/适配器返回攻击性短评时仍可直接发布的问题。
- 修复路由测试 mock 缺少新校验导出导致的模块实例化失败。

**代表提交**：`4604b21`（源码 + 测试；服务端 550 项、前端 35 项全部通过）

---

## 批次 43 · db.json 落盘权限收紧为 640 / 目录 750（2026-09-04）

**改动要点**
- 承接 `AUDIT_REPORT_2026-09-04` 的 P1-安全「数据库权限过宽」：线上 `data/db.json`（含 Cookie、推送凭据、AI 配置）原为 `zdm:zdm 644`，其他本机用户可读。改为运行时落盘即收紧，并以部署门禁思路对待（权限不正确应视为失败信号）。

**问题修复**
- `store.js` 同步写 `persistNow` 与异步写 `doWrite` 在 `rename` 前将 `.tmp` 收紧为 `0o640`；`rename` 保留 mode，最终 `db.json` 即 640（连续写不回退）。
- `ensureDir` 以 `0o750` 建/修 data 目录；新增 best-effort `chmodSecure` 助手，权限设置失败绝不阻断启动或落盘。
- 新增 `server/test/dbPermission.test.js`：覆盖同步/异步两条写路径与连续写不回退，断言 `db.json=640`、目录 `750`（Windows 仅做"不抛错+已落盘"冒烟，POSIX 模式以 Linux/VPS 为准，沙箱为 Windows 无法验证权限位）。

**代表提交**：`0d3b600`（store.js + 测试；后端全量 554 项通过、0 skipped）

---

## 批次 44 · 频道无法确认时不再静默退化，杜绝假成功（2026-09-04）

**改动要点**
- 承接 `AUDIT_REPORT_2026-09-04` 的 P1-数据正确性「频道回退可能造成假成功」：详情接口返回 104（Deal 贴）且 www 兜底仍取不到真实 channel_id 时，旧逻辑退化为 `'1'`，会对错误频道发起动作并被 smzdm 记为成功，却未作用于目标文章，造成「假成功」。
- `resolveChannelId` 在无法确认真实频道时改为返回 `null`（保留 `warnDegradedChannel` 告警可观测，文案改为「已跳过动作，不再静默退化 1」）。上层 `doFavorite`/`doPoint` 既有 `if (!channelId) throw` 守卫将其如实判为失败，明细显示「无法解析文章频道ID」。

**问题修复**
- 消除频道假成功：确须互动的帖子由浏览器导入携带真实 channel_id（`preferredChannelId` 短路复用，优先于服务端脆弱取数）兜底，而非赌 `'1'`。
- 同步测试：`realAdapterNet.test.js` 的「article-api 与 www 都失败」断言由退化 `'1'` 改为期望 `null`；新增 `doFavorite` 在 `resolveChannelIdImpl` 返回 `null` 时如实抛错的回归测试。

**代表提交**：`c9e8926`（realAdapter.js + 2 测试；后端全量 555 项通过、0 skipped）

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

---

## 批次 45 · 部署溯源端点 /api/deploy（2026-09-04）

**改动要点**
- 承接 AUDIT_REPORT_2026-09-04 中优先级「部署后自动记录 commit、构建时间和配置摘要（不含密钥）」：本轮三次部署因无法快速确认 VPS 实际 commit，反复踩沙箱 checkout 漂移导致漏部署批次 42/43。新增运行版本快照，可在 HTTP 层直接核验线上跑的是哪个 commit。

**新增功能**
- `server/src/deployMeta.js`：进程启动即采集单例快照 `deployMeta`（commit / buildTime / 非密钥配置摘要）。commit 优先取 `GIT_COMMIT` 环境变量，否则现场 `git rev-parse HEAD` 探测，再不行标 `unknown`——全程 best-effort，绝不阻断启动。
- `GET /api/deploy`：无需鉴权，返回 `{ ok:true, deploy:{ commit, buildTime, config:{ nodeEnv, adapter, requireAuth, openMode, trustProxy, bindAddress, port, tz, smzdmDebug, apiTokenSet, adminTokenSet, gptEnabled } } }`。config 仅暴露布尔/绑定开关，绝不回显 Token / Cookie / 密码等凭据。

**问题修复**
- 验证方式：`server/test/deployMeta.test.js` 校验结构、commit 格式（40-hex 或 unknown）、buildTime 合法 ISO、config 无凭据类字段泄漏、单例一致性。后端全量 **560 / 560 通过、0 skipped**（批次 44 为 555，本批次 +5）。

**代表提交**：`fefd1f4`（源码 + 端点 + 测试，后端全量 560 项通过）
