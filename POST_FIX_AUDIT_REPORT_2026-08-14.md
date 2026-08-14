# 修复后项目全方位审计报告

## 1. 审计基线

- 审计日期：2026-08-14（Asia/Shanghai）
- 仓库：`zdmclock-clone`
- 分支：`main`
- 审计提交：`d0c2df0986a81a79161448e0e44da64ab6173f34`
- 对比基线：`9c5f5e4` 之后的 4 个修复提交（`6b3ae50`、`2c4cd98`、`b4a21cd`、`d0c2df0`）
- 工作树状态：审计开始时无未提交修改；测试与构建未改动受版本控制文件
- 审计范围：服务端、前端、测试、依赖锁文件、Dockerfile、部署脚本、运行配置与构建产物

## 2. 总体结论

当前提交的服务端测试、前端测试和生产构建全部通过，若干上一轮高风险修复点已实际生效；但项目仍存在 25 项问题，其中高风险 4 项、中风险 17 项、低风险 4 项。未发现可直接定级为严重（Critical）的应用代码问题；依赖审计中存在 1 项 Critical 开发依赖通告，但其触发条件限于 Vitest UI 服务监听场景，故在本报告中并入高风险依赖问题，而未按生产应用严重问题单列。

综合审计结论：**测试通过，但安全、异常处理、并发一致性、部署一致性与测试覆盖仍未完全闭环。**

| 严重程度 | 数量 |
| --- | ---: |
| 严重（Critical） | 0 |
| 高（High） | 4 |
| 中（Medium） | 17 |
| 低（Low） | 4 |
| 合计 | 25 |

## 3. 测试、构建与依赖检查结论

| 检查项 | 环境 | 结果 |
| --- | --- | --- |
| `npm ci` | 全新 Git 导出目录、官方 npm registry | 通过，安装 263 个包 |
| 服务端测试 | Node 25.2.1 | 429/429 通过 |
| 前端测试 | Node 25.2.1 | 26/26 通过；产生 5 条无效 `--localstorage-file` 路径警告 |
| 生产构建 | Node 25.2.1 / Vite 5.4.21 | 通过，128 个模块；JS 244.51 kB，CSS 52.66 kB |
| 服务端测试 | Node 20.19.4 | 429/429 通过 |
| 前端测试 | Node 20.19.4 | 26/26 通过 |
| 生产构建 | Node 20.19.4 / Vite 5.4.21 | 通过 |
| `npm ls --all` | 当前完整安装 | 通过；仅显示平台不适用的 optional dependencies |
| `npm audit --omit=dev` | 2026-08-14 通告数据 | 失败：1 High（`nanoid`） |
| `npm audit` | 2026-08-14 通告数据 | 失败：1 Critical、3 High、3 Moderate |
| Docker 运行阶段清单安装复验 | 临时目录，按 Dockerfile 清单复制顺序 | `npm ci --omit=dev` 通过，服务端运行依赖可从根 `node_modules` 解析 |
| Docker 镜像实构建 | 当前主机 | 未执行：主机未安装 Docker |

### 已验证生效的主要修复点

- 开放模式下任务修改、任务执行和 GPT 回复已受管理员级变更守卫保护：`server/src/routes/tasks.js:251-320`、`server/src/routes/gpt.js:64-67`。
- Cookie 出站 URL 已限制为 HTTPS 的 smzdm 域名，重定向改为手动校验：`server/src/notifier.js:72-90`、`server/src/smzdm/realAdapter.js:112-185`。
- 同账号自动化动作已加入进程内互斥链：`server/src/taskRunner.js:383-400`。
- 任务更新已改为先校验、后在写锁内一次性应用：`server/src/routes/tasks.js:250-314`。
- 关键账号与任务写路径已能等待真实落盘：`server/src/store.js:296-306`、`server/src/routes/users.js:290-301`、`server/src/routes/tasks.js:307-312`。
- 登录不再在 JSON 响应中回显明文 Token；TLS 部署路径可设置 Secure Cookie：`server/src/routes/auth.js:8-17`、`deploy.sh:214-241`。
- 前端静态哈希资源已恢复长期缓存，HTML 保持不缓存：`server/src/index.js:249-295`。
- Dockerfile 已采用构建/运行多阶段结构，运行阶段使用非 root 用户：`Dockerfile:6-43`。

## 4. 问题清单

### 高风险（High）

#### H-01 可信代理配置使客户端可伪造限流与开放模式隔离所使用的来源 IP

- 维度：安全性、越权、异常流量控制、部署配置
- 位置：`server/src/index.js:136-140`、`server/src/index.js:205-213`、`server/src/index.js:350-361`、`server/src/middleware/rateLimit.js:8-24`、`server/src/auth.js:104-117`、`deploy.sh:214-234`、`deploy.sh:288-301`
- 结论：标准域名部署写入 `TRUST_PROXY=true`，Express 随即把 `req.ip` 建立在 `X-Forwarded-For` 可信链上；限流器默认直接使用 `req.ip`，开放模式的数据隔离也主动读取 XFF 首段。Node 服务未限定只监听回环地址，部署脚本也未关闭后端端口的外部可达性。直接访问后端端口或经未清洗 XFF 的代理链时，客户端可逐请求更换 XFF 绕过登录/导入/管理限流，并可影响开放模式的 `/24` 可见性判定。动态复验显示：固定伪造 IP 的第 11 次登录被 429 拦截，更换伪造 XFF 后立即恢复为 401，证明限流键可被客户端切换。

#### H-02 油猴安装脚本在标准部署中仍可由 Host 头决定 Cookie 回传地址

- 维度：安全性、敏感信息泄露、配置一致性
- 位置：`server/src/config.js:77-80`、`server/src/routes/users.js:187-207`、`deploy.sh:224-242`、`deploy.sh:291-301`
- 结论：代码仅在 `PUBLIC_BASE_URL` 存在时使用固定服务地址，否则继续回退到 `req.headers.host`；标准部署脚本生成的 `.env` 未写入 `PUBLIC_BASE_URL`，nginx 又原样转发 `$host`。因此默认生产部署仍保留 Host 头注入路径。受控 Host 可进入安装脚本的 `__SERVER__` 与 `@connect`，用户安装该脚本后，smzdm Cookie 存在被回传至非预期主机的风险。

#### H-03 DNS 出站防护未绑定实际连接地址，且遗漏多类非公网地址段

- 维度：安全性、SSRF、敏感凭据出口
- 位置：`server/src/dnsGuard.js:14-39`、`server/src/dnsGuard.js:53-72`、`server/src/notifier.js:101-123`、`server/src/smzdm/realAdapter.js:143-165`
- 结论：`assertPublicDns` 先独立解析域名，随后 `fetch` 再次自行解析，校验结果未用于实际连接，二者之间存在 DNS 重绑定/解析竞态窗口。地址分类还把 `100.64.0.0/10`、`192.0.0.0/24`、`198.18.0.0/15`、IPv6 `fe80::/10` 中除 `fe80:` 前缀外的地址以及 `ff00::/8` 组播地址判为公开。动态复验中 `100.64.0.1`、`192.0.0.1`、`198.18.0.1`、`fe90::1`、`ff02::1` 均返回非私有。该路径承载 smzdm Cookie 或推送数据，防护失效时会形成内网访问或凭据泄露面。

#### H-04 根工作区锁文件仍锁定已知漏洞依赖，依赖安全门禁失败

- 维度：依赖安全、版本一致性、构建链
- 位置：`package-lock.json:2028-2055`、`package-lock.json:2314-2345`、`package-lock.json:2831-2847`、`package-lock.json:3696-3712`、`package-lock.json:3804-3835`、`web/package-lock.json:2203-2219`、`web/package.json:18-23`
- 结论：根工作区实际安装使用 `nanoid 3.3.17`，而嵌套 `web/package-lock.json` 已记录 `3.3.18`，两份锁文件不一致；根目录 `npm ci` 以根锁为准，导致上一批依赖修复未在实际工作区闭环。`npm audit --omit=dev` 报告 1 项 High（`nanoid <3.3.18`）；完整审计另报告 Vitest 1 项 Critical、Vite/Glob 等 3 项 High、3 项 Moderate。当前应用代码未发现直接调用 nanoid 自定义零长度生成器，Vitest Critical 的触发条件也限于其 UI 服务监听，但依赖安全检查整体仍为失败状态。

### 中风险（Medium）

#### M-01 HTTP 401 的失效 Cookie 被归类为网络退化，账号不会被标记失效

- 维度：逻辑正确性、错误分类、修复点验证
- 位置：`server/src/health.js:22-41`、`server/src/smzdm/realAdapter.js:187-201`、`server/src/smzdm/realAdapter.js:440-451`、`server/test/health.test.js:41-73`
- 结论：真实适配器遇到 401 会抛出 `HTTP 401`；`checkCookie` 对所有抛错统一返回 `degraded:true`，仅“无异常但空身份”才认定真实失效。动态复验得到 `{"valid":false,"degraded":true,"reason":"HTTP 401 @ /user"}`。因此最明确的鉴权失败路径反而不会设置 `cookieExpired`，健康检查会长期保留错误状态并继续让自动化尝试使用失效 Cookie。现有测试只覆盖空身份和 `ETIMEDOUT`，未覆盖 401。

#### M-02 大多数 Express 4 异步写路由仍未接入统一异常转发

- 维度：错误处理、异常路径、可用性
- 位置：`server/package.json:6-18`、`server/src/routes/users.js:71-183`、`server/src/routes/gpt.js:25-60`、`server/src/routes/notify.js:29-50`、`server/src/routes/admin.js:133-150`、`server/src/routes/tasks.js:170-245`、`server/src/routes/health.js:60-67`、`server/src/index.js:24-34`、`server/src/index.js:298-305`
- 结论：项目使用 Express 4，28 个 POST/PUT/DELETE 路由中只有 4 个通过 `wrapAsync` 接入错误中间件。其余异步处理器中的 `persistAwait`、网络调用或其他 Promise 拒绝可能越过 Express 错误处理，产生未响应请求；全局 `unhandledRejection` 只记录日志，不会向该请求返回错误。`uncaughtException` 同样仅记录并继续运行，进程在未知状态下持续服务。

#### M-03 智能启动的“每日一次”判定在并发调用下可重复执行

- 维度：并发、竞态、幂等性
- 位置：`server/src/startup.js:20-68`、`server/src/taskRunner.js:403-405`、`server/src/routes/tasks.js:316-326`
- 结论：`lastStartupDate` 在完整账号流水线结束后才写入，入口没有启动级或账号级的检查并设置原子区。两个并发 `runStartupForAccounts` 可同时通过第 43 行判定并各自执行流水线。动态复验对同一数据库并发调用两次，两次均返回 `ran:1`。账号动作内部锁只能串行执行，不能阻止第二个调用在等待后再次执行非幂等互动任务。

#### M-04 多个写路由在写锁外修改共享内存，校验失败也可留下部分状态

- 维度：并发一致性、事务原子性、边界条件
- 位置：`server/src/store.js:63-75`、`server/src/routes/users.js:253-290`、`server/src/routes/gpt.js:25-44`、`server/src/routes/notify.js:29-50`、`server/src/routes/users.js:71-119`、`server/src/routes/users.js:125-183`
- 结论：写锁的注释声明覆盖“改内存 + persist”，但多个路由只把最终持久化放入锁中，字段赋值与数组修改发生在锁外。`PUT /users/:id` 先写入 nickname/smzdmId，再验证签到配置；后续验证返回 400 时，之前的内存修改不会回滚。并发写请求可在网络 await 与持久化前交错，响应失败也不代表内存保持原值。

#### M-05 部分成功响应在数据真实落盘前返回

- 维度：错误处理、持久化一致性、异常路径
- 位置：`server/src/routes/baoliao.js:66-102`、`server/src/routes/baoliao.js:106-160`、`server/src/routes/health.js:29-39`、`server/src/store.js:265-306`
- 结论：好价批量导入、新增、更新、删除以及健康检查仍使用延迟 1.2 秒的 `persist()`，路由在调度写入后立即返回成功。进程崩溃、SIGKILL、断电或异步写失败时，客户端已收到成功但磁盘数据可能未更新；异步写失败只写日志，原请求无法感知。

#### M-06 Cookie 健康检查对全部账号无上限并发

- 维度：性能、资源占用、外部限流
- 位置：`server/src/health.js:44-69`、`server/src/config.js:161-166`
- 结论：健康检查对最多 500 个默认账号直接执行单个 `Promise.all`，没有并发池或分批边界。单轮可同时建立数百个外部请求并叠加重试、DNS、TLS、响应缓冲与通知操作，造成文件描述符、套接字、内存和上游限流峰值；账号上限允许配置到 100000 时影响进一步放大。

#### M-07 响应体大小上限在完整缓冲之后才判断，不能限制峰值内存

- 维度：性能、拒绝服务、资源占用
- 位置：`server/src/notifier.js:53-64`、`server/src/notifier.js:117-127`、`server/src/smzdm/realAdapter.js:187-201`
- 结论：三条路径分别先调用 `arrayBuffer()` 或 `text()` 读取完整响应，然后检查 2 MB 上限。异常或受控上游仍可令进程先分配完整大响应，限制只影响解析结果，不能阻止下载和内存占用。并发健康检查、自动任务或推送会放大该问题。

#### M-08 资产历史曲线未使用窗口之前的最后快照作为期初余额

- 维度：逻辑正确性、边界条件、统计准确性
- 位置：`server/src/assetLedger.js:175-218`、`server/src/assetLedger.js:219-268`、`server/test/assetLedger.test.js:49-60`、`server/test/assetLedger.test.js:135-155`
- 结论：每个账号的历史累计从零初始化，只在返回窗口内遇到快照或增量后更新；窗口之前的快照虽进入索引，却不会为第一天提供期初余额。动态复验中，一个 31 天前余额为 100/50/20 的账号请求 30 天曲线时，首日与末日总额均返回 0。现有测试只覆盖窗口内快照。

#### M-09 时区修复只覆盖部分“今天”计算，跨日数据仍可能互相矛盾

- 维度：逻辑正确性、边界条件、配置一致性
- 位置：`server/src/routes/clock.js:17-19`、`server/src/routes/clock.js:36-48`、`server/src/scheduler.js:185-209`、`server/src/routes/tasks.js:320-334`、`server/src/assetLedger.js:175-184`、`server/src/assetLedger.js:273-281`
- 结论：签到状态使用 `ZDM_TZ`，但签到日历、任务 `lastRun`、调度任务状态日期和资产统计窗口仍使用进程本地日期。容器 UTC 与 `Asia/Shanghai` 配置并存时，同一时刻可出现状态页“今天”与日历最后一天不同、任务执行日期落在前一天、资产日报归属不一致等跨日错误。

#### M-10 开放模式下无 `recordedIp` 的遗留数据仍对所有匿名网段可见

- 维度：安全性、水平越权、数据迁移
- 位置：`server/src/routes/users.js:57-67`、`server/src/routes/users.js:236-249`、`server/src/routes/baoliao.js:19-32`、`server/src/routes/clock.js:23-33`
- 结论：开放模式的过滤条件明确把没有 `recordedIp` 的遗留账号和好价数据视为所有请求者可见。升级前已有数据、手工数据或迁移缺失字段的数据绕过 `/24` 隔离，匿名访客可读取其账号元数据、统计和好价内容。Cookie 虽被遮罩，但账号关联信息仍跨租户暴露。

#### M-11 部署脚本仅凭文件存在判断依赖与前端是否需要更新

- 维度：构建脚本一致性、依赖版本、部署可靠性
- 位置：`deploy.sh:165-179`
- 结论：只要几个关键包目录存在就跳过安装，只要 `web/dist/index.html` 存在就跳过构建。代码拉取后即使 `package-lock.json`、其他依赖、Vue 源码或 Vite 配置已变化，旧 `node_modules` 与旧 `web/dist` 仍可能被直接运行，导致部署内容与当前提交不一致。

#### M-12 既有 `.env` 不会迁移新增安全配置，TLS 失败后仍强制 Secure Cookie

- 维度：配置一致性、部署异常路径、可用性
- 位置：`deploy.sh:194-203`、`deploy.sh:214-242`、`deploy.sh:288-307`
- 结论：既有 `.env` 只校验 ADMIN_PASSWORD、API_TOKEN、ADMIN_TOKEN、REQUIRE_AUTH 四项，满足后完全跳过新增字段生成，因此升级部署不会获得 TRUST_PROXY、COOKIE_SECURE、ZDM_TZ，且始终没有 PUBLIC_BASE_URL。新部署在提供域名时先写入 `COOKIE_SECURE=1`，而 certbot 失败被降级为警告并继续完成部署；此时仅 HTTP 可用，但浏览器不会发送 Secure 会话 Cookie，登录流程表面成功后仍无法维持鉴权会话。

#### M-13 自更新在依赖或构建失败前已推进工作树提交

- 维度：构建一致性、异常路径、版本原子性
- 位置：`server/src/selfUpdate.js:167-217`
- 结论：流程先执行 `git pull --ff-only`，之后才运行 `npm install` 和前端构建。安装或构建失败时函数返回失败，但仓库 HEAD 已前移；当前进程仍运行旧内存代码，磁盘源码则是新版本，后续重启可能加载未完成依赖安装或未成功构建的混合状态。依赖安装使用 `npm install`，还会允许锁文件在更新流程中发生解析差异。

#### M-14 Cron 的日期与星期组合语义不兼容常见五段 Cron

- 维度：逻辑正确性、兼容性、边界条件
- 位置：`server/src/scheduler.js:90-101`、`server/test/scheduler.test.js:1-65`
- 结论：当“日”和“星期”均非通配符时，实现要求二者同时匹配；常见 Unix/POSIX cron 语义为两者任一匹配。导入或按通用 cron 习惯配置的表达式会显著少执行。现有测试仅验证各字段独立和全字段 AND，不覆盖日期/星期同时受限的兼容语义。

#### M-15 数值配置仍存在未校验项、非整数项和跨字段倒置

- 维度：配置、边界条件、资源控制
- 位置：`server/src/config.js:15-21`、`server/src/config.js:28-29`、`server/src/config.js:106-112`、`server/src/config.js:139-166`、`server/test/config.test.js:8-37`
- 结论：`PORT` 仍直接执行 `Number()`，非法值可导致监听异常；`boundedNum` 接受浮点数，重试次数、账号上限、记录上限等离散配置可成为小数；风险延迟、互动延迟和随机取样的 min/max 分别钳制但不校验相互关系。测试还明确把浮点透传视为正确行为，只验证帮助函数，不验证实际环境变量映射和跨字段约束。

#### M-16 自定义 smzdm 基址带端口时会被白名单错误拒绝

- 维度：配置兼容性、逻辑正确性
- 位置：`server/src/smzdm/realAdapter.js:21-31`、`server/src/notifier.js:72-90`
- 结论：环境基址白名单用 `URL.host` 记录，包含端口；校验函数用 `URL.hostname` 比较，不包含端口。合法的 `https://proxy.example.com:8443` 会记录为 `proxy.example.com:8443`，实际校验值为 `proxy.example.com`，精确白名单永远不匹配，导致带 Cookie 的自建 HTTPS 反代不可用。

#### M-17 关键回归测试缺少已复现边界和部署行为覆盖

- 维度：测试完整性、修复点验证
- 位置：`server/test/health.test.js:41-85`、`server/test/assetLedger.test.js:49-60`、`server/test/assetLedger.test.js:135-155`、`server/test/startup.tz.test.js:18-42`、`server/test/dnsGuard.test.js:6-30`、`server/test/config.test.js:8-37`
- 结论：现有 429 个服务端测试未覆盖 HTTP 401 的 Cookie 分类、历史窗口前快照、并发启动重复、缺失保留地址段、真实环境配置关系、Host 注入、部署脚本升级分支和 Docker 镜像启动。上述缺口中多项已在本次审计通过最小复现触发，说明当前全绿测试不能覆盖关键修复闭环。

### 低风险（Low）

#### L-01 核心模块体积过大且存在双向模块依赖

- 维度：可读性、可维护性、模块耦合
- 位置：`server/src/startup.js:12-14`、`server/src/taskRunner.js:7-8`、`server/src/taskRunner.js:270-420`、`server/src/smzdm/realAdapter.js:110-205`
- 结论：`startup.js` 导入 `taskRunner.js` 的 `runTask`，`taskRunner.js` 又导入 `startup.js` 的 `runStartupForAccounts`，形成循环依赖；同时 `taskRunner.js` 为 524 行、`realAdapter.js` 为 708 行，调度、锁、网络、持久化和业务编排集中于少数模块。当前 ESM 初始化顺序未触发测试失败，但模块边界脆弱，改动影响范围较大。

#### L-02 前端构建不会清理旧哈希产物

- 维度：构建脚本、磁盘占用、发布包一致性
- 位置：`web/vite.config.js:16-21`
- 结论：`emptyOutDir:false` 使每次构建保留不再被引用的旧 JS/CSS。不同路径的干净导出构建已在同一 `dist/assets` 中同时留下两组哈希文件，长期部署会持续增加发布目录和 Docker 构建上下文体积，并使产物目录不能唯一代表当前构建。

#### L-03 根工作区缺少统一测试、审计和代码规范入口

- 维度：编码规范、构建门禁、可维护性
- 位置：`package.json:10-15`、`server/package.json:6-11`、`web/package.json:6-11`
- 结论：根脚本只有 build/start/dev/install，没有统一 test、lint、format、audit 或验证脚本；仓库也不存在 `.github` 工作流目录。服务端与前端测试需分别调用，依赖安全失败不会阻止常规构建，代码规范没有自动化结果可供审计。

#### L-04 注释与实际安全行为存在冲突

- 维度：注释完整性、可读性、运维误导
- 位置：`.env.example:17-27`、`server/src/index.js:138-140`、`server/src/middleware/rateLimit.js:8-20`、`server/src/index.js:363-376`
- 结论：`.env.example` 同时写“默认开启鉴权”和“REQUIRE_AUTH=false（默认）”；限流器注释声称 `req.ip` 为不可伪造网络层地址，但 `trust proxy` 开启后它来自 XFF；开放模式启动警告称所有修改接口匿名放行，而部分高风险变更已由 `mutationGuard` 强制管理员。注释冲突会导致部署人员错误理解实际安全边界。

## 5. 分维度审计结论

| 审计维度 | 结论 |
| --- | --- |
| 代码逻辑正确性与修复点验证 | 主要修复测试通过；Cookie 401 分类、资产期初余额、Cron 组合语义、自定义带端口基址仍有逻辑错误 |
| 潜在缺陷与边界条件 | 并发启动、跨日时区、窗口前快照、数值跨字段关系和遗留数据迁移未闭环 |
| 错误处理与异常路径 | Express 4 异步异常覆盖不足；部分成功响应早于落盘；更新/部署失败会留下混合状态 |
| 安全性漏洞 | 存在 XFF 伪造、Host 注入、DNS 重绑定窗口、保留地址漏判、开放模式遗留数据暴露及漏洞依赖 |
| 性能瓶颈 | 健康检查无上限并发；响应体先完整缓冲；构建目录长期累积旧资产 |
| 代码规范与可读性 | 核心模块过大、存在循环依赖、注释与实际行为冲突、根级规范门禁缺失 |
| 模块依赖与耦合度 | `startup` 与 `taskRunner` 双向依赖；存储锁语义未被所有调用方一致遵循；双锁文件存在版本偏差 |
| 测试用例完整性与通过情况 | Node 20/25 下现有 455 个测试全部通过；关键安全、并发、迁移与部署边界缺少覆盖 |
| 配置文件与构建脚本一致性 | 标准部署未注入 PUBLIC_BASE_URL，既有 `.env` 不迁移新增字段，部署与自更新均可运行旧依赖或旧产物 |

## 6. 最终审计判定

本次修复显著提升了鉴权、Cookie 出站、持久化、账号互斥、前端缓存和 Docker 分层构建，但高风险安全残留仍存在，且若干标记为闭环的修复只覆盖了部分路径。当前提交可证明“现有自动化测试与生产构建通过”，不能证明“安全、并发、部署和边界条件已全面闭环”。
