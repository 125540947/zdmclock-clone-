# zdmclock-clone 修复后全量审计报告

审计日期：2026-08-13（Asia/Shanghai）  
审计对象：`zdmclock-clone`  
审计提交：`9c5f5e40f9b4a3cc4407cbb7c69737c4194f6430`（`main`）  
对比基线：仓库既有审计所针对的 `5d64cde` 及其后续修复提交  
报告性质：只陈述审查结论、影响、位置和验证结果；不包含修复方案、代码示例或教程。

## 一、总体结论

本次共确认 30 项未闭环问题：

| 严重程度 | 数量 | 结论 |
|---|---:|---|
| 严重（Critical） | 0 | 未发现可在默认生产配置下直接成立的严重级问题 |
| 高（High） | 10 | 涉及匿名真实动作、Cookie 外发边界、SSRF、代理认证、会话 Cookie、并发、健康检测、时区和开发依赖 |
| 中（Medium） | 16 | 涉及资产账本、持久化、异常路径、测试、兼容性、部署与构建一致性 |
| 低（Low） | 4 | 涉及缓存效率、构建残留、注释一致性及模块复杂度 |

综合结论：后端回归测试和生产构建均通过，生产依赖审计未发现已知漏洞；但项目整体质量门禁不通过，原因是干净环境中的前端测试仍稳定失败，并且仍有多个条件性高风险安全与核心业务一致性问题。

## 二、审计范围与验证方式

覆盖范围：

- 代码逻辑正确性与既有修复点验证
- 潜在缺陷、输入边界和异常路径
- 鉴权、越权、SSRF、Cookie/Token 泄露等安全边界
- 性能、内存、磁盘与外部请求资源占用
- 并发、互斥、持久化与竞态
- 代码规范、注释、可读性、模块依赖与耦合
- 后端、前端测试及干净环境复现
- 依赖漏洞、Node 版本兼容性、配置、Docker 与部署脚本一致性

验证环境：Windows PowerShell；本机 Node.js `25.2.1` / npm `11.6.2`；另以 Node.js `18.20.8`、`20.19.4`、`22.14.0` 对干净 Git 导出进行兼容验证。

## 三、既有修复点验证结论

| 修复点 | 状态 | 证据位置 | 审查结论 |
|---|---|---|---|
| 默认启用接口鉴权 | 已验证 | `server/src/config.js:33`；`.env.example:10` | `REQUIRE_AUTH` 默认值已改为 `true` |
| Docker Compose 默认仅回环暴露 | 已验证 | `docker-compose.yml:9-12` | 默认端口映射为 `127.0.0.1:3000:3000` |
| Cookie 任意第三方域名外发与跨域重定向 | 部分验证 | `server/src/routes/tasks.js:101-109`；`server/src/smzdm/realAdapter.js:108-169` | 主机名白名单、敏感请求头过滤和手动重定向校验已存在；仍受本报告 H-02 影响 |
| 油猴脚本移除任意 `?server=` 目标 | 部分验证 | `server/src/routes/users.js:187-225` | 查询参数已不再决定目标；仍受 Host 头信任问题 H-04 影响 |
| OPEN_MODE 数据读取隔离 | 已验证 | `server/src/auth.js:194-216`；`server/src/routes/assets.js:9-33`；`server/src/routes/tasks.js:20-62` | 资产、任务配置和管理统计的读取边界已收紧；真实动作仍有 H-01 缺口 |
| 单写者持久化链与退出 flush | 部分验证 | `server/src/store.js:241-294`；`server/src/index.js:270-287` | 同一临时文件并发写入已串行化；成功响应耐久性与自更新退出仍有 M-04、M-05 缺口 |
| 同账号互斥锁 | 部分验证 | `server/src/taskRunner.js:379-397,451-458` | `runTask` 账号分支已串行化；直接签到、GPT 自动发布和启动任务仍可绕过，见 H-07 |
| HttpOnly Cookie 会话迁移 | 部分验证 | `server/src/routes/auth.js:10-30`；`web/src/api/client.js:6-37` | 前端已停止把 Token 写入 localStorage；反代下 Secure 属性和登录响应明文 Token 仍有 H-06、M-13 问题 |
| 限流状态 LRU 化 | 已验证 | `server/src/middleware/rateLimit.js:16-72` | 限流 Map 已具有容量上限和过期淘汰 |
| 启动任务时区修复 | 部分验证 | `server/src/startup.js:22-31` | 启动任务已使用配置时区；全局日期与部署配置仍不一致，见 H-09 |
| 资产曲线快照双算修复 | 部分验证 | `server/src/assetLedger.js:194-223` | 已消除“快照再叠加当日增量”的双算；多账号部分快照仍会重置总量，见 M-02 |

## 四、问题清单

### 高（High）

#### H-01｜OPEN_MODE 仍允许匿名触发全局真实动作与付费调用

- 维度：鉴权、越权、业务逻辑
- 位置：`server/src/auth.js:32-38`；`server/src/routes/tasks.js:249-296,301-315`；`server/src/taskRunner.js:366-376`；`server/src/routes/gpt.js:65-82`
- 结论：`authRequired` 在 `OPEN_MODE` 下直接放行。匿名请求可以修改任务启停、cron、自动发布配置并手动运行任务；未指定 `userId` 时会覆盖全部 `autoRun` 账号。GPT 回复接口同样匿名放行，可消耗服务端配置的模型额度。
- 影响：开放模式暴露时，匿名访客可代表全部账号执行站外动作、改变自动化行为并产生外部 API 费用。

#### H-02｜登录 Cookie 外发仍允许明文 HTTP，且 smzdm 请求没有 DNS 目标校验

- 维度：敏感信息泄露、SSRF、网络安全
- 位置：`server/src/notifier.js:49-66`；`server/src/smzdm/realAdapter.js:108-151,158-169`
- 结论：Cookie 白名单同时接受 `http:` 和 `https:`；真实适配器在每次初始请求及重定向请求前只校验主机名，没有调用 `assertPublicDns`，也没有把已校验的公网 IP 固定到连接。
- 影响：HTTP 配置会在网络中明文传输完整 smzdm Cookie；DNS 污染或重绑定可让白名单域名解析至非公开地址并接收 Cookie。

#### H-03｜Webhook/Bark 的 SSRF 防护可被重定向和二次 DNS 解析绕过

- 维度：SSRF、边界条件
- 位置：`server/src/notifier.js:69-96,140-147,169-180`；`server/src/dnsGuard.js:53-72`
- 结论：`safePushFetch` 只校验初始 URL 的 DNS，随后使用默认自动重定向的 `fetch`；实际连接会再次独立解析 DNS，未绑定第一次校验结果。重定向目标也没有重新执行 URL/DNS 校验。
- 影响：受控公网 webhook 可重定向至内网地址，或在校验与连接之间切换解析结果，形成条件性 SSRF。

#### H-04｜公开油猴脚本生成器仍信任 Host 头并公开嵌入安装令牌

- 维度：敏感信息、Host 注入、凭据边界
- 位置：`server/src/routes/users.js:187-225`；`server/src/auth.js:59-70`；`server/test/routes.test.js:219-248`
- 结论：两个公开脚本端点直接使用 `req.headers.host` 构造 Cookie 回传地址和 `@connect`，同时把静态 `INSTALL_TOKEN` 嵌入公开响应。现有测试明确验证端点无需鉴权，但没有验证未知 Host 的拒绝行为。
- 影响：在反向代理未严格限制 Host 的部署中，攻击者可让可信服务生成指向攻击者域名的安装脚本；任何访问者也可取得具备账号 Cookie 录入/更新能力的安装令牌。

#### H-05｜代理认证的可信来源校验在 TRUST_PROXY=true 时使用了访客 XFF，而非代理连接源

- 维度：鉴权绕过、代理配置
- 位置：`server/src/auth.js:104-117,120-167`；`server/src/routes/auth.js:84-106`；`server/src/config.js:49-65`
- 结论：代理登录分支把 `getClientIp(req)` 与 `PROXY_TRUSTED_IPS` 比较；当 `TRUST_PROXY=true` 时，该函数返回 `X-Forwarded-For` 首段访客 IP。此值不是可信代理的套接字源地址，并可在后端存在直连入口时被请求者伪造。
- 影响：合法代理请求可能因访客 IP 不在代理网段而被拒；直连请求可能伪造认证头和白名单 XFF 后取得 API/Admin Token。

#### H-06｜标准 nginx TLS 部署下会话 Cookie 默认不会设置 Secure

- 维度：会话安全、配置一致性
- 位置：`server/src/routes/auth.js:13-24`；`server/src/config.js:61-65`；`server/src/index.js:126-133`；`deploy.sh:207-222,245-255`
- 结论：Cookie 的 `secure` 依赖 `COOKIE_SECURE=1` 或 `production && req.secure`。部署脚本生成的 `.env` 不包含 `COOKIE_SECURE` 或 `TRUST_PROXY`；nginx 虽传递 `X-Forwarded-Proto`，Express 默认不信任代理，因此后端看到的 `req.secure` 为 false。
- 影响：按项目脚本部署的 HTTPS 站点会签发不带 Secure 的 API/Admin 会话 Cookie，Cookie 可在同一主机的 HTTP 请求或降级链路中被发送。

#### H-07｜同账号互斥锁覆盖不完整，仍存在重复外部动作竞态

- 维度：并发、竞态、逻辑正确性
- 位置：`server/src/taskRunner.js:275-318,379-404,451-470`；`server/src/routes/clock.js:114-137`
- 结论：账号锁仅包裹 `runTask` 的常规逐账号分支。`POST /api/clock/do` 直接调用 `runClockForUser`；GPT 自动发布直接使用首个账号；`startup` 在进入账号锁前提前返回。上述路径可与定时任务或彼此并发。
- 影响：同一账号可能同时签到、评论或执行流水线，引发重复动作、重复记账、站点限流或风控。

#### H-08｜健康检测把所有网络/服务异常判定为 Cookie 失效并阻断后续自动化

- 维度：错误处理、可用性、性能
- 位置：`server/src/health.js:17-34,39-57`；`server/src/taskRunner.js:196-202`；`server/src/startup.js:29-31`；`server/src/routes/health.js:14-30`
- 结论：超时、DNS、限流、服务端 5xx 等异常在一次重试后统一返回 `valid:false`，并写入 `cookieExpired=true`。任务执行和启动流水线随后直接跳过该账号。批量检测还按账号串行执行。
- 影响：一次外部网络故障可把全部账号误标为失效并停止自动化，最长持续到下一次成功健康检查；默认 500 个账号和单请求 10 秒超时下，单轮串行检测可持续数小时。

#### H-09｜时区修复未覆盖部署默认值和全局日期口径

- 维度：核心逻辑、配置、边界条件
- 位置：`server/src/config.js:103-112`；`deploy.sh:207-222`；`server/src/scheduler.js:185-202`；`server/src/routes/clock.js:61-75`；`server/src/routes/admin.js:14-36`；`server/src/assetLedger.js:38,133,178-184`
- 结论：`ZDM_TZ` 默认仍为进程本地时区，部署脚本生成的 `.env` 没有该配置；Docker/Linux 环境通常以 UTC 运行。调度 cron 使用配置时区，但 `lastRun`、签到状态、管理统计和资产账本仍大量使用进程本地 `todayStr()`。
- 影响：默认生产部署可能在预期时间之外执行任务；跨日边界会出现“已执行但页面显示未执行”、日统计落入不同日期及重复执行判断不一致。

#### H-10｜完整开发依赖审计存在 1 个严重、2 个高危和 3 个中危漏洞

- 维度：依赖安全、版本兼容
- 位置：`web/package.json:18-23`；`package-lock.json:2028-2055,2314-2333,3696-3725,3804-3835`
- 结论：官方 npm Registry 审计识别出 Vitest 严重漏洞、Vite 与 glob 高危链路以及 esbuild/Vite 相关中危链路；锁定版本包括 `vitest 2.1.9`、`vite 5.4.21`、`glob 10.4.5`、`esbuild 0.21.5`。`npm audit --omit=dev` 为 0，问题限于开发/测试工具链。
- 影响：开发服务器、Vitest UI 或相关 CLI 在不受信任环境中使用时，存在任意文件读取/执行、路径穿越、命令注入或信息泄露风险；生产运行时依赖未受该批漏洞影响。

### 中（Medium）

#### M-01｜自定义任务的碎银增量字段名错误，账本会静默丢失碎银收益

- 维度：功能正确性、测试缺口
- 位置：`server/src/taskMatrix.js:252-265`；`server/src/assetLedger.js:81-97`；`server/src/taskRunner.js:492-495`
- 结论：自定义任务返回的 `explicit` 使用 `silverDelta` 属性，而资产账本只读取 `explicit.silver`。没有权威余额刷新结果时，碎银增量会按 0 处理。
- 影响：用户资产、任务贡献和日收益统计低报碎银收益，且接口本身仍返回成功。

#### M-02｜多账号日曲线把“部分账号快照”当作“全体账号总量”

- 维度：数据正确性、边界条件
- 位置：`server/src/assetLedger.js:194-223`；`server/test/assetLedger.test.js:88-101,137-151`
- 结论：某日只要存在任意账号快照，代码就把当日已有快照的合计作为全体累计值重置 `run`。现有测试覆盖完整双账号快照和单账号序列，没有覆盖多账号部分快照。
- 影响：只刷新部分账号余额的日期会使其他账号历史余额从总曲线中消失，后续累计基线持续偏低。

#### M-03｜外部响应大小限制在完整缓冲之后执行，raw 路径完全绕过限制

- 维度：性能、内存、异常路径
- 位置：`server/src/smzdm/realAdapter.js:173-176`；`server/src/notifier.js:127-165`
- 结论：真实适配器先执行 `resp.text()` 把完整响应读入内存，再检查 2 MB 字符长度；`raw=true` 在检查前直接返回。推送响应直接执行 `json()`，没有响应体上限。
- 影响：异常或受控上游可用超大响应造成瞬时内存放大、垃圾回收压力甚至进程内存耗尽。

#### M-04｜多数写接口在数据真正落盘前即返回成功

- 维度：持久化、错误处理、并发
- 位置：`server/src/store.js:265-294`；`server/src/routes/tasks.js:295-297,312-317`
- 结论：`persist()` 只设置 1.2 秒定时器并立即返回；`await withWriteLock(() => persist())` 不等待磁盘写入，也无法把后续异步写失败反馈给当前 HTTP 请求。
- 影响：API 已确认成功的数据可在断电、SIGKILL、进程崩溃或异步写失败时丢失；调用方收到的成功状态不代表耐久提交完成。

#### M-05｜自更新重启路径绕过持久化 flush，并返回更新前提交号

- 维度：异常路径、数据一致性、自更新
- 位置：`server/src/selfUpdate.js:215-226,230-260`；`server/src/scheduler.js:150-159`
- 结论：`scheduleRestart` 直接 `process.exit(0)`，不会经过 `index.js` 的 SIGTERM/SIGINT flush；更新结果中的 `commit`/`commitShort`来自更新前的 `state`。
- 影响：更新前 1.2 秒窗口内的已确认写入可能丢失；界面和通知会把旧提交号报告为已更新版本。

#### M-06｜任务更新不是原子操作，校验失败仍可留下内存修改

- 维度：逻辑漏洞、输入校验、并发
- 位置：`server/src/routes/tasks.js:249-296`
- 结论：代码先修改 `enabled`，再依次验证 `cron`、`articleId`、`articleSource` 等字段；任一后续校验返回 400 时，先前字段已留在共享内存对象中，且修改过程不在写锁内部。
- 影响：请求表面失败但任务实际状态已变化，后续任何持久化操作都可能把该隐式变更写入数据库。

#### M-07｜会修改状态并触发外部通知的 Cookie 检测使用 GET

- 维度：HTTP 语义、CSRF、错误路径
- 位置：`server/src/routes/health.js:11-30`；`server/src/routes/auth.js:13-19`
- 结论：`GET /api/health/cookies` 会修改全部账号的 `cookieExpired`、持久化数据库并发送通知。会话 Cookie 使用 `SameSite=Lax`，顶层跨站导航可携带该 Cookie。
- 影响：具备有效会话的浏览器可被跨站导航触发批量外部检测、状态改写和通知发送；缓存、预取或监控工具也可能误触发副作用。

#### M-08｜跨域配置与 HttpOnly Cookie 客户端配置不一致

- 维度：配置一致性、功能正确性
- 位置：`server/src/index.js:129-133`；`web/src/api/client.js:4-12`；`.env.example:22-23`
- 结论：前端启用 `withCredentials:true`，后端 CORS 只设置 origin，没有启用 `Access-Control-Allow-Credentials`。项目同时公开了独立前端域名的 `CORS_ORIGIN` 配置场景。
- 影响：前后端分域部署时浏览器不会接受或发送凭据化跨域响应，登录和全部受保护 API 失效。

#### M-09｜干净环境中的前端测试稳定失败，测试仍断言已删除的 localStorage Token 行为

- 维度：测试完整性、修复点验证
- 位置：`web/test/client.test.js:51-72`；`web/src/api/client.js:33-37,56-65`
- 结论：Node 20、22 的干净 Git 导出均为 24 项通过、2 项失败；失败用例仍要求登录和 `setToken` 写入 localStorage/Authorization，而生产代码已明确改为 no-op 和 HttpOnly Cookie。
- 影响：前端测试套件总体失败，且 HttpOnly 会话迁移没有得到与新行为一致的回归验证。

#### M-10｜声明支持 Node 18，但后端测试脚本不能在 Node 18 执行

- 维度：版本兼容、构建脚本
- 位置：`package.json:20-22`；`server/package.json:8-12,19-21`
- 结论：根包和后端均声明 `node >=18`；Node `18.20.8` 对测试脚本参数 `--experimental-test-module-mocks` 和 `--test-timeout` 报 `bad option`，测试进程在收集用例前退出。
- 影响：声明范围内的 Node 18 环境无法执行项目质量验证，版本元数据与实际工具链要求不一致。

#### M-11｜部署脚本会忽略拉取失败，并可长期保留过期依赖或构建产物

- 维度：部署、构建一致性、供应链
- 位置：`deploy.sh:33,98-118,131-149,141-153`
- 结论：脚本未启用 `set -e`；`git pull --ff-only` 失败被 `|| true` 吞掉；只有关键包缺失时才执行 `npm install`，只有 `web/dist/index.html` 不存在时才构建；Node 二进制下载后未进行独立校验。
- 影响：部署命令可显示继续成功但运行旧代码、旧依赖或旧前端；锁文件变化不一定进入实际安装状态，下载内容完整性只依赖 TLS 传输。

#### M-12｜Docker 构建不从源码生成前端，并会打包已提交的代理运行时状态

- 维度：构建一致性、敏感元数据、模块依赖
- 位置：`Dockerfile:1-20`；`.dockerignore:1-30`；`.gitignore:1-27`；`.claude-flow/daemon-state.json:1`；`.swarm/memory.db:1`
- 结论：镜像直接复制仓库中的 `web/dist`，没有在镜像构建中验证源码与产物一致；`.claude-flow/**` 和 `.swarm/memory.db` 已被 Git 跟踪且未被 `.dockerignore` 排除。
- 影响：镜像可运行与源码提交不一致的前端，并携带本地代理状态、日志、指标、路径信息和无关数据库文件。

#### M-13｜HttpOnly 迁移后登录响应仍把静态 API/Admin Token 返回给前端 JavaScript

- 维度：敏感信息泄露、会话设计
- 位置：`server/src/routes/auth.js:61-82,102-118`；`web/src/api/client.js:56-65`
- 结论：普通、代理和开放模式登录响应仍包含 `token`，管理员登录还包含 `adminToken`；前端 `login()` 原样把响应数据返回调用方。Cookie 内保存的也是长期静态 API/Admin Token，而非独立会话标识。
- 影响：登录时存在的 XSS、浏览器扩展或前端日志链仍可读取长期高权限令牌；HttpOnly 只隔离了后续 Cookie 读取，未隔离登录响应中的明文凭据。

#### M-14｜数值型环境变量缺少有限值和范围校验

- 维度：边界条件、异常处理、配置
- 位置：`server/src/config.js:77,91-97,110-162`；`server/src/smzdm/realAdapter.js:63-78,132-142`
- 结论：超时、重试、窗口、容量、限流和抖动参数普遍直接使用 `Number(...)`，没有统一拒绝 `NaN`、负数、极大值或上下界倒置。
- 影响：错误配置可导致 `AbortSignal.timeout` 抛异常、定时任务永久不触发、睡眠时间异常、容量限制失效或单次任务占用资源显著放大。

#### M-15｜Express 4 异步路由异常与全局未捕获异常处理存在挂起和不确定状态

- 维度：异常路径、可用性
- 位置：`server/package.json:14-17`；`server/src/routes/clock.js:114-137`；`server/src/index.js:24-34,252-260`
- 结论：项目使用 Express 4，部分 `async` 路由没有本地 try/catch 或异步包装；Promise 拒绝不会自动进入 Express 错误中间件。全局 `unhandledRejection` 和 `uncaughtException` 只记录日志并继续运行。
- 影响：未捕获拒绝可使 HTTP 请求长期不返回；未捕获同步异常后进程继续服务时，内存状态和资源状态不再具有确定性。

#### M-16｜项目缺少统一测试门禁，安全修复的关键负路径覆盖不足

- 维度：测试完整性、代码规范、构建一致性
- 位置：`package.json:10-14`；`server/test/notifier.test.js:119-149`；`server/test/routes.test.js:219-248`；`server/test/taskRunner.test.js:398-429`
- 结论：根脚本没有统一 `test`、lint、格式、类型检查或覆盖率命令；现有测试只验证 SSRF 初始 URL/DNS、脚本正常 Host 和锁函数自身，没有覆盖重定向 SSRF、Host 注入、锁绕过调用链、Secure Cookie 反代场景及多账号部分快照。
- 影响：后端 402/402 通过不能代表前端或端到端质量门禁通过，多项当前高风险路径不会被现有回归测试捕获。

### 低（Low）

#### L-01｜带内容哈希的静态资源被统一设置为 no-store

- 维度：性能、缓存
- 位置：`server/src/index.js:241-255`
- 结论：`/assets/*` 与 HTML 一样被强制设置 `Cache-Control: no-store, must-revalidate`，尽管文件名已经包含内容哈希。
- 影响：每次页面访问都会重新传输 JS/CSS，增加带宽、延迟和服务端静态文件 I/O。

#### L-02｜前端构建明确保留历史哈希产物

- 维度：构建、资源占用
- 位置：`web/vite.config.js:16-21`
- 结论：`emptyOutDir:false` 禁止构建前清空输出目录，连续构建会保留不再被引用的旧资源。
- 影响：`web/dist`、Git 仓库和镜像体积会随构建次数增长，并增加人工核对产物一致性的难度。

#### L-03｜注释和前端链接仍保留已废弃的 Token/server 语义

- 维度：可读性、注释完整性
- 位置：`server/src/auth.js:41-43`；`server/src/index.js:134-135`；`web/src/views/Users.vue:151-154,266-271`
- 结论：注释仍描述 localStorage 会话 Token 和查询参数安装流程；安装链接继续附加后端已忽略的 `?server=`；CSP 注释仍以保护 localStorage Token 为目标。
- 影响：文档化行为与实际实现不一致，增加后续维护和安全边界判断错误的概率。

#### L-04｜核心模块体积偏大且跨职责耦合明显

- 维度：可读性、可维护性、模块耦合
- 位置：`web/src/views/Tasks.vue:1`（773 行）；`server/src/smzdm/realAdapter.js:1`（604 行）；`web/src/views/Users.vue:1`（585 行）；`server/src/taskRunner.js:1`（约 500 行）
- 结论：单文件同时承担 UI 状态、校验、网络编排、业务规则、风控、资产记账或协议适配等多类职责。
- 影响：变更影响面难以隔离，审查和单元测试粒度偏粗，回归缺陷更难定位。

## 五、测试、构建与依赖审计结果

| 检查项 | 环境 | 结果 | 结论 |
|---|---|---:|---|
| `npm test -w server` | 当前工作区 / Node 25.2.1 | 402 通过，0 失败 | 通过 |
| `npm test -w server` | 干净 Git 导出 / Node 20.19.4 | 402 通过，0 失败 | 通过 |
| `npm test -w web` | 干净 Git 导出 / Node 20.19.4 | 24 通过，2 失败 | 失败 |
| `npm test -w web` | 干净 Git 导出 / Node 22.14.0 | 24 通过，2 失败 | 失败 |
| `npm test -w web` | 干净 Git 导出 / Node 25.2.1 | 17 通过，9 失败 | 失败；其中 7 项为 Node 25/jsdom Web Storage 环境差异，2 项与 Node 20/22 相同 |
| 后端测试脚本 | 干净 Git 导出 / Node 18.20.8 | 参数解析失败，未收集用例 | 与 `engines >=18` 不一致 |
| `npm run build` | 当前工作区 | 成功；Vite 5.4.21，128 modules | 通过 |
| `npm run build` | 干净 Git 导出 | 成功 | 通过 |
| `npm audit --omit=dev --registry=https://registry.npmjs.org` | 根工作区 | 0 漏洞 | 生产依赖通过 |
| `npm audit --registry=https://registry.npmjs.org` | 根工作区 | 1 严重、2 高、3 中 | 完整依赖失败 |

当前工作区附加状态：审计开始前已存在未跟踪文件 `web/package-lock.json:1` 和不完整的 `web/node_modules`；因此当前目录的前端测试先以依赖加载错误退出。干净 Git 导出排除了该本地状态后，仍稳定复现 2 项源代码测试失败。

## 六、按审查维度归纳

| 审查维度 | 主要结论编号 |
|---|---|
| 代码逻辑正确性与修复点验证 | H-01、H-07、H-08、H-09、M-01、M-02、M-06 |
| 潜在缺陷与边界条件 | H-08、H-09、M-02、M-03、M-14 |
| 错误处理与异常路径 | H-08、M-04、M-05、M-15 |
| 安全性漏洞 | H-01 至 H-06、H-10、M-07、M-13 |
| 性能瓶颈与资源占用 | H-08、M-03、L-01、L-02 |
| 代码规范与可读性 | M-16、L-03、L-04 |
| 模块依赖与耦合度 | H-10、M-12、L-04 |
| 并发与竞态 | H-07、M-04、M-06 |
| 测试完整性与通过情况 | M-01、M-02、M-09、M-10、M-16 |
| 配置文件与构建脚本一致性 | H-06、H-09、M-08、M-10、M-11、M-12、M-14、L-02 |

## 七、最终审计判定

- 后端单元/路由测试：通过。
- 前端测试：不通过。
- 生产构建：通过。
- 生产依赖已知漏洞审计：通过。
- 完整开发依赖已知漏洞审计：不通过。
- 修复点闭环程度：部分闭环；默认鉴权、回环暴露、读取隔离、单写者、HttpOnly 和 LRU 等主体修复成立，但安全出站、代理认证、会话 Cookie、并发、健康检测、时区、资产边界及质量门禁仍未完全闭环。
- 项目整体审计判定：不通过。
