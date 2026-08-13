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
