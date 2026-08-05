# zdmclock-clone 系统性代码审计报告

> 审计日期：2026-08-05｜范围：全量源码（server 15 模块 + web 前端 + 部署配置）
> 审计维度：可行性 / 安全性 / 运行性｜风险等级：高 / 中 / 低
> 说明：上次审计已修复 baoliao 写接口鉴权、.dockerignore、时区统一、.gitignore 补 data_demo/data_test、README 安全须知。本报告为新增补充。

---

## 一、可行性检查（Feasibility）

| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| F1 | 后端全部 15 个 .js 模块 | `node --check` 全量语法通过；import 解析完整，无未定义引用 | —（通过） | — |
| F2 | `realAdapter.getUserInfo` | 调用 `https://www.smzdm.com/user/`（Web 端点，返回 HTML），JSON.parse 必失败→抛错；被 `users.js` 的 try/catch 吞掉，导致 real 模式录入账号拉不到真实昵称/积分，仅存默认值 | 中 | getUserInfo 改用 `user-api.smzdm.com` 对应端点；或显式标注为"未实现" |
| F3 | `realAdapter.doComment/doFavorite/doPoint` + `taskRunner.runTask` | 这些动作需要 `articleId`，但调度链只传 `{count}`，`articleId` 恒为 `''`→real 模式必失败；且 `count` 参数被适配器完全忽略（永远只动作 1 次） | 中 | **已实施（2026-08-05 第三轮）**：task 配置新增 `articleId`，经 `taskRunner` 传入适配器；前端「自动任务」页可填写目标文章ID/链接（纯数字或 smzdm 链接均可，适配器 `normalizeArticleId` 自动提取）。注：real 接口路径为社区经验值、best-effort，标记未验证 |
| F4 | `GptReply.vue` | 仅存 localStorage，后端无对应 GPT 任务类型/适配器；"启用自动回复"开关对后端零效果 | 低 | **已实施（2026-08-05 第三轮）**：新增 `gptAdapter`（OpenAI 兼容 `/chat/completions`）+ `routes/gpt`（config 持久化 + reply 真实调用）；前端开关与提示词持久化到后端，「生成回复」调用真实大模型；未配置 `GPT_API_KEY` 时前端明确提示 |
| F5 | `UserClock.vue:80` | `today` 用 `toISOString()`（UTC），与后端 `todayStr()`（本地）不一致；北京 00:00–08:00 期间前端"今天"标签与后端判定错位，造成"今日已签到"视觉矛盾 | 低 | 前端 `today` 改用本地日期（与 `localDateStr` 同基准） |
| F6 | `server/package.json` | express `^4.19.2`（锁 4.x），`app.get('*')` 在 4 下有效，无 Express 5 崩溃风险 | —（通过） | — |
| F7 | 依赖与构建 | server 仅 express/cors/dotenv；web 仅 vue/vue-router/axios；`npm run build` 此前已成功产出 dist | —（通过） | — |

---

## 二、安全性检查（Security）

### 高危
| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| S1 | `index.js:15` + `config.js:17` | `app.use(cors())` 全开 + `requireAuth` 默认 `false`→任何来源可对写接口（增删账号含真实 cookie、提交爆料、改任务）发请求。端口一暴露公网即裸奔 | 高 | 部署前 `REQUIRE_AUTH=true` 且 `cors({origin: 你的域名})`；或仅限本地/内网 |
| S2 | `routes/auth.js` + `config.js` | 鉴权为静态 token：`/auth/login` 校验 `admin/admin123`（默认）→返回 `config.apiToken`（默认 `zdmclock-dev-token`），无过期/无签名/无防爆破。启用鉴权却用默认凭据="登录"即被绕过 | 高 | 部署前改强随机 `ADMIN_PASSWORD`/`API_TOKEN`；考虑 token 随机化+短期过期 |
| S3 | `store.js` + `data*/db.json` | 真实 smzdm cookie 明文存于 `db.json`（`data_demo` 含你的真实登录态）。任何能读文件者=拥有你的 smzdm 会话 | 高 | 已用 .gitignore/.dockerignore 排除；另需：文件权限收紧、备份/云盘同步警惕、可对 cookie 字段静态加密 |

### 中危
| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| S4 | `routes/users.js:86` | `GET /:id/smzdm` 未挂 `authRequired`→匿名可触发 `getUserInfo(u.cookie)`，即用你存储凭据对外发请求（未授权使用凭证）；同文件 `/:id/refresh` 已保护，前后不一致 | 中 | 给 `/:id/smzdm` 加 `authRequired` |
| S5 | `routes/admin.js:8` | `GET /stats` 未鉴权→匿名可读账号数/任务数/今日签到数/最近签到记录（含昵称、日期、金币） | 中 | 加 `authRequired` |
| S6 | `routes/clock.js:26,43` | `/status`、`/history` 未鉴权→泄漏签到活动规律（无 cookie，但暴露行为画像） | 中 | 按敏感度决定保护 |

### 低危
| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| S7 | `routes/users.js:13` + `Users.vue:30` | `maskCookie` 仅遮罩中间，仍暴露 cookie 前 4 + 后 4 字符；`Users.vue` 直接展示 `u.cookie`（遮罩值） | 低 | 改为全 `***` 或仅显示"已保存" |
| S8 | `Baoliao.vue:60-61` | `<a :href="d.url">`/`:href="d.smzdmUrl"` 未校验协议；若数据含 `javascript:` 伪协议，点击触发 DOM XSS（自 XSS，个人工具风险低） | 低 | 渲染前校验 `^https?://`，否则不渲染链接 |
| S9 | `routes/users.js:17` | `POST /` 仅校验 cookie 非空，未校验类型/长度；`nickname`/`smzdmId` 可为任意类型（如对象→`[object Object]`） | 低 | 增加类型与长度约束 |
| S10 | `index.js:38` | 错误响应 `err.message` 原样返回，可能泄露内部路径；无 `helmet`/安全响应头 | 低 | 生产环境 500 返回泛化消息；可选加 helmet |

---

## 三、运行性检查（Runtime / Operational）

### 高危
| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| R1 | `realAdapter.call` (`:57`) | `fetch` 未设超时（无 `AbortSignal`）→smzdm 响应缓慢/不返时 Promise 永久挂起。`/clock/do`、`/baoliao/submit` 等到 OS TCP 超时（分钟级）；scheduler 中 `runTask` 挂起后 `.then` 不触发且 `lastFiredMinute` 已置位→本分钟不重试，任务卡 pending 无错误 | 高 | 给 fetch 加 `signal: AbortSignal.timeout(10000)`；scheduler 调用加整体超时与失败兜底 |

### 中危
| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| R2 | `store.js` + `clock.js:67` | 并发写竞争：`cache` 单例 + `persist()` 单次原子，但两并发请求各自 mutate 后 persist→后写覆盖先写（lost update）；`POST /clock/do` 的"今日已签"检查与写入非原子→两并发签到可同时通过→real 模式双重签到 smzdm | 中 | 关键写操作加串行化（写锁/队列/事务） |
| R3 | `store.js:36-40` | `load()` 解析失败静默重置为 `defaultData()` 且不立即持久化→db.json 损坏时静默清空（数据丢失） | 中 | 解析失败时备份损坏文件并告警，而非静默丢弃 |

### 低危
| # | 文件/模块 | 发现 | 等级 | 修复建议 |
|---|---|---|---|---|
| R4 | `index.js:45` | scheduler 在 `app.listen` 中无条件启动（`npm run dev` 也会跑）；若 `SMZDM_ADAPTER=real` 且任务启用，开发服务器会真去签到 | 低 | dev 模式默认停用 scheduler 或启动打印明确警告 |
| R5 | 全局 | 无日志分级/轮转，仅 `console.log/error`；无健康检查外的监控指标 | 低 | 结构化日志 + 关键错误告警 |
| R6 | `routes/auth.js` | `/auth/login` 无防爆破/速率限制 | 低 | 公网部署时加失败计数或速率限制 |

---

## 四、优先级汇总（按性价比）

- **P0（公网暴露前必做）**：S1 CORS 限制+强制鉴权｜S2 改默认 admin 密码/token｜R1 realAdapter 加请求超时
- **P1**：S4 `/:id/smzdm` 加鉴权｜S5 `/stats` 加鉴权｜R2 并发写串行化（防真实双重签到）｜F5 前端 today 改用本地日期
- **P2**：S8 baoliao href 协议校验｜F2/F3 getUserInfo 与 article 任务明确为未实现或补全｜R3 损坏 db 备份而非清空｜S7 cookie 全遮罩

## 五、整体结论

代码整体**可编译、可构建、开箱即跑（mock 模式）**；架构清晰（适配器可插拔、存储抽象、前后端分离）。主要风险集中在**"默认无鉴权 + CORS 全开 + 明文 cookie"这一组合**——对个人单机内网使用可接受，但**一旦端口暴露到公网即为高危**，且你已在用真实 smzdm 账号 cookie，故 S1/S2/S3 不是纸面问题。real 适配器的**请求缺超时（R1）**是真实可靠性隐患，建议优先补上。real 模式下 getUserInfo/评论/收藏/点赞为未验证死路径（F2/F3），应在 UI/文档中明确，避免误以为"接好就能用"。

---

## 六、P0 修复记录（2026-08-05 已实施并验证）

| 审计项 | 修复内容 | 涉及文件 | 验证 |
|---|---|---|---|
| **S1 CORS** | 默认 `cors({ origin: false })`（不返回 CORS 头，仅同源）；新增 `CORS_ORIGIN` 环境变量做白名单；安全告警提示公网风险 | `server/src/index.js`、`README.md`、`.env.example` | 默认带 `Origin: evil` 请求**无 ACAO 头**；设 `CORS_ORIGIN=http://foo.test` 后该域收到 ACAO、非白名单域被拒 ✓ |
| **S2 默认凭据** | `API_TOKEN` 未设置时**每次启动随机生成**（不再使用静态 `zdmclock-dev-token`）；保留 `ADMIN_PASSWORD` 默认但启动时告警；新增 `apiTokenIsDefault`/`adminPasswordIsDefault` 标记用于告警；README 更新 | `server/src/config.js`、`server/src/index.js`、`README.md`、`.env.example` | 登录返回 token 经校验**不等于**旧静态值；启动日志打印两条安全告警 ✓ |
| **R1 请求超时** | `realAdapter.call` 统一加 `signal: AbortSignal.timeout(SMZDM_REQUEST_TIMEOUT)`，并捕获 `TimeoutError/AbortError` 转译为「请求超时」友好错误；新增 `SMZDM_REQUEST_TIMEOUT` 环境变量（默认 10000ms） | `server/src/smzdm/realAdapter.js`、`.env.example`、`README.md` | 黑洞服务（接受连接不响应）在 **615ms**（设 600ms）被中止并抛「请求超时」，证明不再永久挂起 ✓ |

> 注：S1 的"强制鉴权"（`REQUIRE_AUTH` 默认 `false`）本次**未强制改为 true**，以保持开箱即跑与现有 UI 无登录拦截；但已通过启动告警 + README 安全须知明确要求公网部署时必须设 `true`。其余 P1/P2 项按计划后续处理。

---

## 七、P1/P2 与复审缺陷修复记录（2026-08-05 第二轮「全部修复」）

> 范围：审计报告中未修的 P1/P2 项 + 复审新发现的 N1 与 b1–b9 杂项。
> 验证：`node --check` 全量通过；新增 `server/test/clockCore.test.js`（7 用例全绿）。

| 编号 | 等级 | 修复内容 | 涉及文件 |
|---|---|---|---|
| **N1** | 高 | 定时自动签到不落库：新建 `clockCore.applyClock`（单一事实来源，幂等+写记录+更新金币/连续天数），`routes/clock.js` 与 `taskRunner.js` 共用，自动每日签到现在会真正生成签到记录并更新统计 | `server/src/clockCore.js`（新）、`routes/clock.js`、`taskRunner.js` |
| **R2** | 中 | 并发写串行化：新增 `store.withWriteLock`（Promise 链），所有"改内存 + persist"经同一链条，消除 lost-update 与真实双重签到竞态 | `store.js`、`routes/clock.js`、`scheduler.js`、`taskRunner.js` |
| **R3** | 中 | 损坏 db 备份：解析失败时先 `fs.copyFileSync` 备份为 `.corrupt-<ts>` 再重置，避免静默清空不可恢复；`persist` 加 `if(!cache) return` 防御 | `store.js` |
| **R4** | 低 | dev 模式停用调度器：`app.listen` 仅 production 启动 `startScheduler`，否则打印警告，避免 `npm run dev` 真去签到 | `index.js` |
| **S4** | 中 | `GET /:id/smzdm` 加 `authRequired`，与 `/:id/refresh` 一致，杜绝匿名用存储凭据对外发请求 | `routes/users.js` |
| **S5** | 中 | `GET /stats` 加 `authRequired`，匿名不再可读账号/任务/签到数等行为画像 | `routes/admin.js` |
| **S6** | 中 | `/status`、`/history` 加 `authRequired`，收敛签到活动规律泄漏 | `routes/clock.js` |
| **S7** | 低 | `maskCookie` 改为全隐藏 `"已保存(已隐藏)"`，不再暴露 cookie 片段 | `auth.js` |
| **S9** | 低 | `POST /`（建账号）校验 cookie 为字符串且非空；nickname/smzdmId 用 `clean()` 长度钳制，拒绝对象等非预期类型 | `routes/users.js` |
| **S10** | 低 | 生产环境 500 返回泛化消息「服务器内部错误」，避免泄露内部路径 | `index.js` |
| **b1** | — | 昨天用本地日历 `setDate(-1)` 计算（`localYesterdayStr`），替代 `Date.now()-86400000` 在 DST/跨月边界偏移 | `clockCore.js` |
| **b2** | — | 分页 `pageSize` 钳制 ≤200；任务动作 `count` 钳制 1–5（`COUNT_MAX`） | `routes/clock.js`、`taskRunner.js` |
| **b3** | — | 新增 `validateCron`（5 段 + 取值范围严格校验）；`PUT /tasks/:id` 在校验失败时返回 400，避免非法 cron 静默永不触发 | `scheduler.js`、`routes/tasks.js` |
| **b5** | — | `realAdapter.call` 对响应体加 2MB 上限，超则拒绝，防超大响应占内存 | `smzdm/realAdapter.js` |
| **b6** | — | `scheduler.tick` 整体包 `try/catch`，同步异常不再中断 30s 轮询循环 | `scheduler.js` |
| **b7** | — | 新增 `auth.safeEqual`（恒定时间比较）；登录与 token 校验均改用，缓解时序侧信道 | `auth.js`、`routes/auth.js` |
| **b8** | — | 新增 `schedulerRunning` 状态 + `isSchedulerRunning()`；health 端点如实返回 `scheduler: on/off` | `scheduler.js`、`index.js` |
| **b9** | — | 新增最小单元验证，覆盖 `applyClock`（首签/重复幂等/连续天数）、`withWriteLock`（串行化）、`validateCron`（合法/非法） | `server/test/clockCore.test.js` |
| **F2** | 中 | `getUserInfo` 改用 `user-api.smzdm.com` 基址（原 `www.smzdm.com/user/` 返回 HTML 无法解析）；端点标注为社区经验值未验证 | `smzdm/realAdapter.js` |
| **F3** | 中 | `doComment/doFavorite/doPoint` 真正按 `count`（上限 5）循环，消息如实；`mock` 适配器同样按 count 循环 | `smzdm/realAdapter.js`、`smzdm/mockAdapter.js` |
| **F5** | 低 | 前端 `today` 改用本地日期（`localToday`），与后端 `localDateStr` 同基准，消除北京凌晨 00:00–08:00 视觉错位 | `web/src/views/UserClock.vue` |
| **S8** | 低 | 爆料链接渲染前校验 `^https?://`，阻断 `javascript:` 伪协议自 XSS；补 `noreferrer` | `web/src/views/Baoliao.vue` |

### 残余项（主动留白，非遗漏）
- **S1 强制鉴权**：`REQUIRE_AUTH` 默认仍 `false`（保持开箱即跑 + UI 无登录拦截），依靠启动告警 + README 安全须知要求公网部署时设 `true`。
- **S3 明文 cookie**：已通过 `.gitignore`/`.dockerignore` 排除 + 部署指南收紧文件权限；静态加密（字段级加密）属可选增强，未在本轮实现。
- **F4 `GptReply.vue`**：纯前端 localStorage 演示，后端无对应任务/适配器，UI 已应明确标注"演示"；本轮未改动。
- **R5/R6**：日志分级、登录防爆破为低优增强，留待后续。
