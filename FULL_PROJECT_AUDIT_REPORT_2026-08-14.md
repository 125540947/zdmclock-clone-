# zdmclock-clone 修复后全方位审计报告

- 审计日期：2026-08-14
- 审计基线：`e002c0e6b0b429914790c3173fc150d564e89857`
- 基线分支：`main`
- 审计对象：后端、前端、测试、依赖、环境配置、构建与部署脚本
- 审计方式：静态逐文件审查、接口契约交叉核对、针对性运行时复现、完整测试、生产构建、依赖树与安全审计
- 严重度：严重 / 高 / 中 / 低
- 审计限制：本机未安装 Docker，未执行容器镜像构建和容器内健康检查；未连接真实 smzdm 账号、真实 GPT 服务及真实通知渠道。

## 一、审计结论摘要

本次共确认 29 项问题：严重 0 项、高 7 项、中 17 项、低 5 项。

当前自动化测试与生产前端构建均通过，但测试结果未覆盖默认鉴权登录闭环、存在账号时的手动 Cookie 健康检测、真实反向代理链、开放模式遗留数据详情访问等关键路径。审计期间对其中多项路径进行了独立运行时复现，确认存在登录界面无法完成登录、健康检测返回 500、代理来源识别可被伪造、开放模式遗留账号详情越权等实际故障。

## 二、验证执行结果

| 检查项 | 结果 | 审计结论 |
|---|---:|---|
| `npm test` | 通过 | 后端 425/425、前端 26/26，共 451 项通过；前端测试输出 5 次 `--localstorage-file` 无有效路径警告。 |
| 前端生产构建 | 通过 | Vite 5.4.21；JS 375.11 kB（gzip 124.67 kB），CSS 63.28 kB（gzip 11.45 kB）。 |
| `npm ls --all` | 通过 | 依赖树无缺失的必需包；仅有平台相关可选依赖未安装。 |
| `npm run lint` | 表面通过 | 子工作区均未定义 `lint`，实际没有执行任何静态检查。 |
| `npm run audit:deps` | 失败 | 当前 npm registry 为 npmmirror，其安全审计端点返回 404，脚本退出码为 1。 |
| 官方 npm registry 全量审计 | 未通过 | 6 个开发依赖漏洞：1 个严重、2 个高、3 个中。 |
| 官方 npm registry 生产依赖审计 | 通过 | `--omit=dev` 为 0 个已知漏洞。 |
| 独立 `web` 锁文件安装校验 | 失败 | `npm ci --dry-run` 报 `Missing: @phosphor-icons/vue@2.2.1 from lock file`。 |
| Docker 构建与运行 | 未执行 | 本机无 `docker` 命令。 |

## 三、问题清单

### 高严重度

#### H-01 默认鉴权登录的前后端契约断裂，登录浮层无法关闭

- 位置：`web/src/App.vue:130-145`；`web/src/api/client.js:56-65`；`server/src/routes/auth.js:58-78,102-112`
- 维度：逻辑正确性、修复点验证、错误路径、测试完整性
- 结论：后端已改为仅通过 HttpOnly Cookie 建立会话，成功响应不再包含 `token` 或 `adminToken`；API 客户端也已通过 `/auth/config` 正确刷新 `session`。根组件仍以 `data.token` 作为唯一成功条件，并在管理员模式下继续检查 `data.adminToken`。标准密码登录和开放模式管理员登录实际已成功写入 Cookie，但界面固定进入“登录失败”分支，`needsLogin` 保持为真，默认 `REQUIRE_AUTH=true` 的核心使用路径被登录遮罩阻断。
- 复现状态：静态契约交叉验证确认；后端测试明确断言成功响应不含上述两个字段。

#### H-02 存在账号时手动 Cookie 健康检测固定返回 500

- 位置：`server/src/routes/health.js:2,30-41`
- 维度：逻辑正确性、异常路径、修复点验证、测试完整性
- 结论：该路由只导入了 `load`、`persist`、`withWriteLock`，实际在第 41 行调用未定义的 `persistAwait`。无账号分支会提前返回，因此现有无账号测试通过；一旦数据库中存在账号，检测完成后的持久化阶段抛出 `ReferenceError`，接口返回 500。
- 复现状态：已用临时数据目录创建账号后调用 `POST /api/health/cookies`，稳定得到 `ReferenceError: persistAwait is not defined` 和 HTTP 500。

#### H-03 布尔配置解析对未知值失败开放，可因拼写错误关闭鉴权

- 位置：`server/src/config.js:11-14,58,74,85,92,171,173`
- 维度：安全、配置一致性、边界条件
- 结论：`parseBool` 仅识别真值集合，除 `undefined` 外的任何未知字符串均返回 `false`。`REQUIRE_AUTH` 虽声明默认值为 `true`，但 `REQUIRE_AUTH=tru`、尾随空格或其他拼写错误会静默变为 `false`，直接关闭接口鉴权；同类行为也影响默认开启的风控配置。配置错误没有拒绝启动或告警。
- 复现状态：以 `REQUIRE_AUTH=tru` 启动配置模块，读取到 `requireAuth:false`。

#### H-04 标准 nginx 反代链下可伪造 XFF 首段绕过开放模式网段隔离

- 位置：`server/src/auth.js:104-117,202-229`；`server/src/index.js:138-142`；`deploy.sh:345-348`
- 维度：安全、越权、修复点验证、代理配置
- 结论：Express 已按受信任代理网段计算 `req.ip`，但 `getClientIp` 在 `TRUST_PROXY=true` 时绕过 Express 的可信代理链解析，直接采用 `X-Forwarded-For` 最左段。部署脚本中的 nginx 使用 `$proxy_add_x_forwarded_for`，会保留客户端原有 XFF 并追加真实来源；攻击者可控制最左段，使开放模式的 `/24` 可见性判断、账号归属记录和资产隔离采用伪造地址。
- 复现状态：以受信任 loopback 反代模型发送 `X-Forwarded-For: 10.1.2.3, 203.0.113.77`，不同真实来源仍可读取伪造同网段账号。

#### H-05 代理认证来源白名单为空时默认放行，直连者可伪造认证头取得管理员会话

- 位置：`server/src/config.js:74-81`；`server/src/auth.js:161-166`；`server/src/routes/auth.js:80-103`；`server/src/index.js:342-350`
- 维度：安全、认证绕过、配置错误路径
- 结论：启动阶段只强制 `TRUST_PROXY_AUTH=true` 时存在 `PROXY_AUTH_HEADER`，没有强制可信代理来源。`PROXY_TRUSTED_IPS` 为空时 `ipInCidrList` 返回真，任何能够直连后端的请求者只需自行附加配置的认证头即可通过 `/api/auth/login`，获得普通与管理员会话 Cookie。
- 复现状态：可信来源列表为空、附带伪造 `X-Forwarded-User` 的直连请求返回 200 并签发会话 Cookie。

#### H-06 默认管理员口令为公开弱口令，且原生启动默认监听所有接口

- 位置：`server/src/config.js:58-69,98-101`；`server/src/index.js:352,390-392`；`.env.example:13-15,27-31`
- 维度：安全、默认配置、敏感权限
- 结论：未设置或留空 `ADMIN_PASSWORD` 时实际口令回退为 `admin123`；`BIND_ADDRESS` 默认 `0.0.0.0`。服务仅输出告警并继续运行，没有阻止默认凭据与公网监听组合。直接源码启动或复制示例环境文件但未补全口令时，默认鉴权可由公开口令通过。
- 复现状态：空 `ADMIN_PASSWORD` 配置读取结果为 `admin123`，同时监听地址为 `0.0.0.0`。

#### H-07 开放模式下爆料草稿写入无容量与字段上限，可匿名持续放大数据库

- 位置：`server/src/routes/baoliao.js:108-132`；`server/src/store.js:313-352`；`server/src/index.js:208-215`
- 维度：安全、性能、资源占用、边界条件
- 结论：`POST /api/baoliao` 使用在开放模式下直接放行的 `authRequired`，没有条目总量上限、字段长度上限，也没有针对该端点的请求限流。`MAX_BAOLIAO_ITEMS` 只在 `mergeBaoliao` 的批量合并路径执行，手工草稿创建不经过该限制。匿名请求可反复写入接近 256 kB 请求体上限的数据，持续扩大内存缓存、`db.json`、列表响应和每次全库序列化成本。

### 中严重度

#### M-01 开放模式遗留账号详情路由仍可绕过“无 recordedIp 不可见”规则

- 位置：`server/src/routes/users.js:43-57,60-71,270-283`
- 维度：安全、水平越权、修复点验证
- 结论：账号列表和共享可见性函数把缺少 `recordedIp` 的遗留账号视为不可见；`GET /api/users/:id` 仍保留 `u.recordedIp &&` 条件，缺少该字段时跳过权限拒绝。已知账号 ID 的开放模式访客可以读取列表中不可见的遗留账号元数据。
- 复现状态：同一遗留账号在列表中 `total:0`，直接详情请求返回 200。

#### M-02 开放模式新增与批量导入的爆料未记录来源 IP，创建者随后不可见

- 位置：`server/src/routes/baoliao.js:20-35,69-105,108-132`；`server/src/store.js:334-348`
- 维度：逻辑正确性、边界条件、模块契约
- 结论：开放模式列表按 `recordedIp` 的 `/24` 网段过滤，但手工创建和 `mergeBaoliao` 生成的对象都不写入 `recordedIp`。匿名创建或批量导入返回成功后，同一访客重新加载列表时该数据会被过滤；数据仍留在数据库并仅对管理员可见。

#### M-03 批量导入页把全权限 API Token 放入查询字符串

- 位置：`server/src/index.js:69-72,112-120`；`server/src/auth.js:41-55`；`server/src/routes/baoliao.js:64-69`
- 维度：安全、敏感信息泄露、前后端契约
- 结论：HttpOnly Cookie 改造后，独立批量导入页仍要求用户填写 API Token，并拼接为 `?token=`。该凭据是通用全权限 Token，不是窄权限安装 Token；请求 URL可进入反向代理访问日志、监控链路和浏览器网络记录，扩大长期静态凭据暴露面。

#### M-04 `ZDM_TZ=UTC` 被当作进程本地时区处理

- 位置：`server/src/clockSchedule.js:21-36`；`server/src/store.js:368-380`；`server/src/assetLedger.js:175-186,305-314`
- 维度：逻辑正确性、边界条件、时区兼容性
- 结论：`zonedWallClock` 和 `todayStrTZ` 都把字符串 `UTC` 与 `local` 走同一分支并使用本地时间 getter。主机本地时区不是 UTC 时，显式配置 UTC 仍得到本地日期、小时和星期，影响 cron、签到日期、补签、任务节流和资产统计窗口。

#### M-05 时区修复未覆盖管理统计与资产写入，容器跨日窗口数据口径不一致

- 位置：`server/src/routes/admin.js:13-18,35-38`；`server/src/assetLedger.js:33-40`；`server/src/config.js:151-153`
- 维度：逻辑正确性、修复点验证、模块一致性
- 结论：管理概览和签到分布仍用进程本地 `todayStr()`；资产账本事件的 `date` 也固定使用本地日期。生产部署配置 `ZDM_TZ=Asia/Shanghai` 而容器为 UTC 时，北京时间 00:00–08:00 内，签到状态、管理统计和资产日报会归属到不同日期。

#### M-06 非法 IANA 时区没有启动校验，可持续中断调度并使相关接口返回 500

- 位置：`server/src/config.js:151-153`；`server/src/clockSchedule.js:39-51`；`server/src/store.js:371-379`；`server/src/scheduler.js:182-249`
- 维度：异常处理、配置边界、可用性
- 结论：`ZDM_TZ` 接受任意字符串。非法值在 `Intl.DateTimeFormat` 构造时抛出 `RangeError`；调度 tick 捕获后整轮跳过，依赖日期计算的同步 API 经全局错误处理返回 500。错误配置不会在启动阶段暴露为致命配置错误。

#### M-07 开放模式网段隔离仅支持 IPv4，IPv6 访客无法访问自己录入的数据

- 位置：`server/src/auth.js:120-166,202-229`；`server/src/routes/users.js:60-69,106-108`
- 维度：边界条件、网络兼容性、功能正确性
- 结论：`sameSegment`、CIDR 解析和可信来源判断都只接受 IPv4。IPv6 请求被记录为 `recordedIp` 后，后续比较固定返回假，导致创建者自己的账号、签到数据和资产数据不可见；IPv6 代理来源也无法命中 `PROXY_TRUSTED_IPS`。

#### M-08 独立跨站前端部署与会话 Cookie 属性不兼容

- 位置：`server/src/routes/auth.js:12-18`；`server/src/index.js:143-152`；`web/src/api/client.js:6-12`
- 维度：配置一致性、部署兼容性、认证流程
- 结论：服务支持 `CORS_ORIGIN` 并返回凭据许可，客户端也启用 `withCredentials`，但会话 Cookie 固定为 `SameSite=Lax`。当前端与 API 位于不同站点而非同站子域时，浏览器不会在跨站 XHR 中发送该 Cookie，造成登录成功后受保护 API 仍未认证。

#### M-09 DNS 重绑定检查与实际连接之间存在可利用的二次解析窗口

- 位置：`server/src/dnsGuard.js:73-98`；`server/src/notifier.js:149-165`；`server/src/smzdm/realAdapter.js:148-171`
- 维度：安全、SSRF、敏感凭据出口
- 结论：代码先用 `dns.lookup` 校验地址，随后交给内置 `fetch` 再次独立解析域名，未把已校验 IP 固定到连接。攻击者控制的 DNS 可在两次解析间返回不同地址，使自定义 webhook 的 SSRF 防护存在 TOCTOU 窗口；源码注释也明确承认该残留限制。

#### M-10 多个写路由在进入写锁前保存数组索引或对象引用，存在竞态与错误成功响应

- 位置：`server/src/routes/users.js:290-353,374-386`；`server/src/routes/baoliao.js:135-160`
- 维度：并发、竞态、数据一致性
- 结论：删除路由在写锁外计算数组索引，账号更新/刷新在外部网络等待前获取可变对象引用。锁队列已有任务或更新与删除交错时，索引可因前序删除而失效并删除错误条目或不删除任何条目；更新可能修改已经从数据库移除的孤立对象，仍持久化并返回 200。写锁只串行化后半段，未保证“重新定位目标—修改—落盘”的整体原子性。

#### M-11 每账号签到记录上限的快速跳过条件不成立，可长期不执行截断

- 位置：`server/src/store.js:199-228`；`server/src/config.js:194-199`
- 维度：逻辑正确性、资源占用、性能
- 结论：`enforceClockCap` 在总记录数不超过“账号数 × 每账号上限 + 64”时直接返回，但总量低于该阈值不代表单个账号未超限。账号数量较多、记录集中于少数账号时，单账号可远超配置上限而长期不触发分组截断，`db.json` 持续增长。

#### M-12 资产快照无保留上限，且每次关键写入都会同步序列化整个数据库

- 位置：`server/src/assetLedger.js:53-64`；`server/src/store.js:231-253,296-306`
- 维度：性能、资源占用、持久化架构
- 结论：资产账本限制为 5000 条，但 `assetSnapshots` 按“账号 × 日期”无限增长。所有关键写请求在单线程事件循环上执行完整 `JSON.stringify(cache)`，再串行写同一个 JSON 文件。长期运行或高账号数场景下，内存、磁盘、写锁等待和事件循环停顿随历史数据线性增长。

#### M-13 开放模式聚合签到状态存在记录数与可见账号数的乘法复杂度

- 位置：`server/src/routes/clock.js:85-95`
- 维度：性能、资源占用
- 结论：作用域原本为 `Set`，代码先展开为数组，再对每条签到记录执行 `ids.includes`。复杂度为 O(签到记录数 × 可见账号数)；在默认 500 个账号及多年记录规模下，单次状态请求可产生数千万次线性比较。

#### M-14 当前开发与测试工具链包含 6 个已知漏洞

- 位置：`web/package.json:18-24`；`package-lock.json:723-733,3904-3923`
- 维度：依赖安全、版本兼容性
- 结论：使用官方 npm registry 审计得到 1 严重、2 高、3 中，共 6 个开发依赖漏洞，涉及 `vitest`、`vite`、`esbuild`、`glob`、`@vitest/mocker`、`vite-node`。严重项包含 Vitest UI 服务任意文件读取/执行，高危项包含 Vite 路径穿越、Windows UNC/NTLM 凭据暴露与 `server.fs.deny` 绕过。生产依赖审计为 0，风险集中在开发服务器、测试服务和 CLI 使用场景。

#### M-15 `web/package-lock.json` 与 `web/package.json`、根工作区锁不一致

- 位置：`web/package.json:12-16`；`web/package-lock.json:7-21,2883-2893`；`package-lock.json:723-733,3911-3922`
- 维度：依赖、构建一致性、可复现性
- 结论：独立 web 锁文件缺少已声明的 `@phosphor-icons/vue`，并锁定 Vue 3.5.41；根工作区锁包含图标依赖但锁定 Vue 3.5.40。根目录工作区安装可成功，单独进入 `web` 执行确定性安装会失败，不同安装入口得到不一致依赖图。
- 复现状态：仅复制 `web/package.json` 与 `web/package-lock.json` 后执行 `npm ci --dry-run`，报缺少 `@phosphor-icons/vue@2.2.1`。

#### M-16 自更新失败回滚并非完整事务，且忽略变更清单命令失败

- 位置：`server/src/selfUpdate.js:171-188,208-231`
- 维度：错误处理、异常路径、构建一致性
- 结论：更新后 `git diff --name-only` 的退出状态未检查，命令失败时会把变更集合当作空集合并跳过依赖安装与前端构建，仍可能报告更新成功。安装或构建失败时只执行 `git reset --hard` 回退受版本控制文件，已变化的 `node_modules` 和构建产生的未跟踪哈希文件不会恢复到更新前状态，因此“全有或全无”的注释与实际状态不一致。

#### M-17 测试覆盖遗漏已导致高严重度回归在全绿测试中存活

- 位置：`web/test/client.test.js:51-68`；`server/test/routesCore.test.js:232-241`；`server/test/authSecurity.test.js:47-57`；`web/package.json:8-11`；`server/package.json:8-12`
- 维度：测试完整性、修复点验证
- 结论：前端测试验证了 API 客户端接受无 token 响应，但没有挂载根组件验证登录浮层闭环；健康检测路由只覆盖无账号提前返回；代理测试直接把“取 XFF 首段”固化为期望，没有覆盖 nginx 追加客户端原始 XFF 的真实链路。项目没有覆盖率统计或最低阈值。451 项测试全部通过仍未发现 H-01、H-02、H-04 和 M-01。

### 低严重度

#### L-01 根 `lint` 脚本实际为空操作

- 位置：`package.json:15-17`；`server/package.json:8-12`；`web/package.json:8-11`
- 维度：代码规范、构建脚本一致性
- 结论：根脚本使用 `--if-present` 调用两个工作区的 `lint`，但两个工作区均未定义该脚本。命令以 0 退出但没有执行 ESLint、格式检查、未定义变量检查或 Vue 模板静态分析；H-02 的未定义标识符因此未被构建门禁发现。

#### L-02 示例配置未覆盖大量实际配置项

- 位置：`.env.example:9-124`；`server/src/config.js:71-209`
- 维度：配置一致性、可维护性
- 结论：代码读取但示例文件未列出的配置项共 40 个，包括 `OPEN_MODE`、`TRUST_PROXY`、`TRUST_PROXY_AUTH`、`PROXY_AUTH_HEADER`、`PROXY_TRUSTED_IPS`、`PUBLIC_BASE_URL`、`HOST_ALLOWLIST`、`INSTALL_TOKEN`、`ZDM_TZ`、`HEALTH_CONCURRENCY`、容量上限和风控区间等。示例配置无法完整表达当前运行时能力与安全边界。

#### L-03 README 中鉴权与健康检测接口说明已过期

- 位置：`README.md:88-89,110,148,234`
- 维度：文档一致性、可维护性
- 结论：README 仍标记 `REQUIRE_AUTH` 默认值为 `false`，仍描述登录后获取 Bearer Token，并把手动 Cookie 检测写成 `GET /api/health/cookies`；当前代码默认鉴权为真、登录不回显 Token、GET 检测固定返回 405。文档与当前接口契约相互矛盾。

#### L-04 前端构建不清理旧哈希产物，发布目录持续累积无引用文件

- 位置：`web/vite.config.js:17-21`；`Dockerfile:14-16,29-30`
- 维度：构建脚本、性能、发布一致性
- 结论：`emptyOutDir:false` 使每次构建保留历史 JS/CSS 哈希文件。当前 `web/dist/assets` 已同时存在两组 JS/CSS 产物；Docker 构建先复制仓库现有 `web/dist` 再执行同样配置的构建，运行镜像也会携带这些未被 `index.html` 引用的旧资源，发布体积随构建次数增长。

#### L-05 核心模块体量和职责耦合度偏高

- 位置：`server/src/smzdm/realAdapter.js:1-721`；`server/src/taskRunner.js:1-524`；`web/src/views/Tasks.vue:1-773`；`web/src/views/Users.vue:1-585`
- 维度：可读性、可维护性、模块耦合
- 结论：真实适配器同时承载出口安全、DNS 检查、重定向、响应解析、签名和多类业务动作；任务运行器同时承载取样、风控、签到、GPT、抓取、资产落账和账号锁；两个 Vue 页面同时包含大量接口编排、表单状态、业务校验和样式。单文件职责跨度大，修改影响面与回归验证成本较高。

## 四、按审计维度归纳

| 审计维度 | 对应结论 |
|---|---|
| 代码逻辑正确性与修复点验证 | H-01、H-02、M-01、M-02、M-04、M-05、M-11 |
| 潜在缺陷与边界条件 | H-03、M-06、M-07、M-11、M-16 |
| 错误处理与异常路径 | H-02、M-06、M-10、M-16 |
| 安全性漏洞 | H-03、H-04、H-05、H-06、H-07、M-01、M-03、M-09、M-14 |
| 性能瓶颈与资源占用 | H-07、M-11、M-12、M-13、L-04 |
| 代码规范与可读性 | L-01、L-05 |
| 模块依赖与耦合度 | M-14、M-15、L-05 |
| 测试用例完整性与通过情况 | H-01、H-02、H-04、M-17 |
| 配置文件与构建脚本一致性 | H-03、H-05、H-06、M-04、M-06、M-08、M-15、M-16、L-01、L-02、L-03、L-04 |

## 五、最终判定

当前版本不满足“修复后可视为全面闭环”的审计条件。默认鉴权登录、手动健康检测和标准 nginx 代理链均存在已复现的高严重度问题；开放模式还存在认证来源、网段隔离和资源上限缺口。自动测试、生产前端构建及生产依赖审计通过，但不足以覆盖或否定上述结论。
