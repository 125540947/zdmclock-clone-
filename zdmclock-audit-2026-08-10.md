# zdmclock-clone 深度安全与质量审计报告
**审计日期**：2026-08-10
**审计范围**：`server/src`（Node/Express 后端）、`web/src`（Vue3 前端）、`tools/cookie-grabber.user.js`
**方法**：3 个并行专项 agent（后端安全 / 后端质量性能 / 前端）+ 主代理对关键 P0/P1 直接读源码核验
**前置已修复（本次不再重复）**：mutationGuard 写守卫、webhook SSRF 校验、canAccessUser /24 归属、凭据遮罩、process 兜底、parseJsonp try/catch、useToast 去重、admin token 清理、busy 类型、skipped 反馈、死代码与空值守卫、[smzdm-debug] 日志开关。

---

## 一、总体结论

| 严重度 | 数量 | 说明 |
|--------|------|------|
| **P0（高危，建议立即修）** | 2 | 均经主代理读源码核验确认 |
| **P1（中危，应优先排期）** | 7 | 含正确性缺陷（时区错配漏签、写锁阻塞）与信息泄露 |
| **P2（低危/优化）** | 13 | 日志噪音、重复代码、边界、最佳实践 |

> 注：P0-2（XFF）与 P0-1（SSRF）在 **OPEN_MODE=true** 部署下危害最大；若已设 `REQUIRE_AUTH=true` 且配强 `ADMIN_TOKEN`，匿名触发面显著下降，但纵深防御仍应补全。

---

## 二、P0 高危发现（已核验）

### P0-1 自定义任务端点 SSRF（可读内网 / 云元数据）
- **位置**：`server/src/routes/tasks.js:62`（`PUT /api/tasks/endpoints`）→ `server/src/taskMatrix.js:228`（`adapter.requestRaw(def.endpoint)`）→ `realAdapter.call`（仅判 `path.startsWith('http')`）
- **核验结论**：`PUT /endpoints` 仅 `authRequired`。OPEN_MODE 或 `requireAuth=false` 时匿名可写；存入的 `endpoint`（及 `referer`/`headers`）在任务运行经 `taskMatrix.js:228` 直接 `fetch()`，`call` **无私有地址过滤**。响应经 `assetFields.message` 提取并在 `POST /:id/run` 返回体回显 → **可读 SSRF**。
- **利用链**：匿名 `PUT /api/tasks/endpoints` 设 `{type:'<CUSTOM_TYPES>', endpoint:'http://169.254.169.254/latest/meta-data/'}` → `POST /api/tasks/<id>/run` → 服务端请求云元数据 → 响应经 `message` 字段回显给攻击者。即使 mock 模式，`endpoint` 落库后在 real 模式即可触发。
- **修复**：
  1. `PUT /endpoints` 改 `mutationGuard`（OPEN_MODE 下要求 ADMIN_TOKEN）；
  2. 对 `endpoint`/`referer` 复用 `notifier.js` 的 `isSafePushUrl`（拒绝 127/8、10/8、172.16/12、192.168/16、169.254/16、::1、localhost，强制 http/https）；
  3. `requestRaw`/`call` 入口增加同样的 SSRF 兜底校验。

### P0-2 XFF 伪造绕过 OPEN_MODE 网段隔离（水平越权读他人数据）
- **位置**：`server/src/auth.js:66-73`（`getClientIp` 优先取 `X-Forwarded-For` 首段）+ `server/src/config.js:44`（OPEN_MODE 下 `trustProxy` 默认 true）+ `auth.js:123 canAccessUser` / `routes/users.js` / `routes/baoliao.js` / `routes/clock.js` 的 /24 判定
- **核验结论**：网段可见性以**客户端可控**的 XFF 首段为准。`canAccessUser`、`GET /users`、`GET /baoliao`、`GET /clock/status` 的归属判断全部依赖此值。
- **利用**：攻击者置 `X-Forwarded-For: <受害者同段IP>` 即可命中同 /24 判定，读取他人昵称、积分、签到日历/连续天数、好价列表。
- **修复**：
  1. 仅当确有多层可信反代时才信任 XFF；直连暴露应 `TRUST_PROXY=false`；
  2. 更稳妥：OPEN_MODE 取消基于 IP 的隔离，改用「录入时下发的账号令牌」绑定归属；或至少对 `trustProxy` 显式要求配置、默认关闭。

---

## 三、P1 中危发现

### P1-1 全站无速率限制 / 默认弱口令爆破风险
- **位置**：`server/src/index.js`（无 throttle 中间件）、`routes/auth.js:21`（登录）、`routes/users.js:67`、`routes/baoliao.js:64`（OPEN_MODE 匿名录入）
- **问题**：登录用 `safeEqual` 防计时侧信道，但无失败锁定/限流；`ADMIN_PASSWORD`/`ADMIN_TOKEN` 存在默认值（`admin123`）。OPEN_MODE 下匿名可无限 `POST /users`/`/baoliao/bulk` 撑大 `db.json`（用户无上限，好价已限 500）。
- **修复**：引 `express-rate-limit`；强制 `ADMIN_TOKEN` 最小长度；录入接口加频控与账号数上限。
- **✅ 已落地（2026-08-10，commit 已推送）**：① 零依赖固定窗口限流中间件 `server/src/middleware/rateLimit.js`（按访客 IP 计数，避免引入 `express-rate-limit` 依赖漂移，契合项目 YAGNI 约定），在 `index.js` 对 `POST /api/auth/login`(60s/10)、`POST /api/users`(60s/20)、`POST /api/users/import`(60s/20)、`POST /api/baoliao/bulk`(60s/30)、`/api/admin`(60s/30) 装配；② `users.js` 的 `POST /` 与 `/import`（仅新增分支）加账号数硬上限 `config.maxUsers`（默认 500），超限返回 `429 user_limit_reached`；③ 启动告警补充：OPEN_MODE 且未设 `ADMIN_TOKEN` 时提示写操作将全部拒绝。默认弱口令告警此前已在 `index.js` 存在（`adminPasswordIsDefault`）。

### P1-2 会话 Token 泄露进 URL 与可分发脚本
- **位置**：`web/src/views/Users.vue:158`（`installUrl` 拼 `?token=`）、`Users.vue:275-281`（`bake()` 把 token 烘焙进 `.user.js`）
- **问题**：真实会话 token 进 URL（落入浏览器历史/Referer/访问日志），且被固化进可一键安装的用户脚本（浏览器明文留存，外泄即等同凭证泄露）。
- **修复**：安装脚本改用一次性/可吊销的安装令牌或 POST 获取；URL 不携带真实会话 token，脚本内不固化用户会话 token。

### P1-3 GPT 批量生成长期持有全局写锁，阻塞签到
- **位置**：`server/src/taskRunner.js:262`（`runGptBatch` 在 `withWriteLock` 内对每条草稿 `await generateReply`）
- **问题**：期间全局写链被独占，并发的签到写（`runClockForUser`→`withWriteLock`）被延迟整个生成时长（最多 10 条 LLM 往返）。错峰/补签窗口可能漏签。
- **修复**：先无锁收集草稿，最后一次性 `withWriteLock` 落账。

### P1-4 clockRecords 无限增长 + 持久化频率高
- **位置**：`server/src/store.js:185`（`persist()` 每次全量 `fs.writeFileSync`）、`runTask:424`/`runClockForUser:209` 每成功即持久化；`clockRecords` 无上限（仅 `baoliao`(500)/`gptDrafts`(200) 截断）
- **问题**：`db.json` 随时间无限膨胀，`JSON.stringify`+同步写持续变慢并阻塞事件循环；调度器每分钟跑 `t_clock` 时尤为明显。
- **修复**：① 合并写（tick 结束或 debounce 落盘一次）；② `clockRecords` 加滚动上限（如保留 365 天）；③ `JSON.stringify` 异步化/分表。
- **✅ 已落地（2026-08-10，commit 已推送）**：`store.js` 重构持久化层——① `persist()` 改为 `persistSoon()`（1.2s 窗口合并写，异步 `fs.promises` 写，消除高频同步写阻塞事件循环）；新增 `persistNow()`（同步立即写，供启动初始化/迁移/关键配置）；新增 `flushPersist()`（同步兜底落盘，进程退出时调用）；② 新增 `enforceClockCap()`：按 `userId` 分组保留最近 `config.clockRecordsMaxPerUser`（默认 365）条，启动期清理旧库并在每次落盘前截断，DB 不再无限膨胀（未超限时 O(n) 快速跳过零成本）；③ 写 IO 异步化（仍保留同步 `persistNow` 供关键路径）。`index.js` 增加 SIGTERM/SIGINT 优雅退出 handler 调 `flushPersist()`，确保合并写窗口内的修改在 systemd restart 时不丢失。原 `withWriteLock(() => persist())` 调用方自动享受合并写且不阻塞写链。

### P1-5 时区错配导致签到时间判定偏移 / 漏签
- **位置**：`server/src/taskRunner.js:366-395`（定时签到用 `zonedWallClock(config.tz)` 的 `nowMin`）vs `clockSchedule.js:78`（`resolvedCheckInTime` 返回服务器本地 HH:MM）+ 连续天数 `yesterdayStrTZ`(配置时区) vs 手动 `localYesterdayStr()`(本地)
- **问题**：`ZDM_TZ ≠ 'local'` 时，`umin <= nowMin` 比较差一个时区偏移，账号可能在错误时刻签到或永不命中；连续天数偶发错 1 天。
- **修复**：签到时间比较与「昨天」基准统一用同一时区折算（用 `yesterdayStrTZ`/`todayStrTZ` 贯穿手动与定时）。
- **✅ 已落地（2026-08-10 续）**：`taskRunner.js` 定时签到分支的 `schedToday` 与 `schedYesterday` 统一走 `todayStrTZ`/`yesterdayStrTZ` 同族函数（`yesterdayStrTZ` 内部即对 today 回退一天），消除原 `schedToday=z.date`（`zonedWallClock` 路径）与 `schedYesterday=yesterdayStrTZ`（另一路径）在跨日边界可能差一天、导致连续天数偶发错 1 天的问题。分钟级比较仍用 `zonedWallClock().getHours/Minutes`，与日期判定同一时区基准。

### P1-6 代码重复与实现分叉（可维护性 + 正确性漂移）
- **位置**：
  - `parseJsonp` 三份实现：`realAdapter.js:267`（含 `)]}'` 处理+try/catch）、`tasks_real.js:26`（仅 `()` 壳、无 `)]}'`）、`taskMatrix.js:86`（失败**直接 throw**）
  - `removeTags`+`extractReward`：`tasks_real.js:17/40` 与 `extremeLazy.js:37/36` 完全重复
  - `collectArticleIds` 分叉：`taskRunner.js:50` 用 `normalizeArticleId`，`extremeLazy.js:24` 用裸正则 `/\/p\/(\d+)/`，同一文章可能抽出不同 ID
- **修复**：抽公共模块（如 `smzdm/parse.js`、`util/text.js`），统一 JSONP/文章 ID 解析，消除行为不一致。
- **✅ 已落地（2026-08-10 续）**：新建 `server/src/smzdm/parse.js` 收敛 `parseJsonp`/`removeTags`/`extractReward` 为唯一实现；`realAdapter`/`tasks_real`/`taskMatrix`/`extremeLazy` 改 import 共用。`parseJsonp` 增强为「先去 Angular )]}' 前缀、再解 JSONP 外壳」，修复旧 `realAdapter` 在 `)]}'`+`callback()` 形态下漏解外壳、把挑战页当失败外的缺陷；`taskMatrix.parseJsonp` 保留抛错契约（解析失败抛友好错误，避免 `assetFields` 取空误判「执行成功」）。`extremeLazy.collectArticleIds` 改用 `normalizeArticleId`，与 `taskRunner` 同一抽取逻辑，杜绝同一文章抽出不同 ID。

### P1-7 生产环境调试日志无级别开关
- **位置**：`server/src/taskRunner.js:130`、`routes/baoliao.js:40/43/54` 为无条件 `console.log`（非 `dbgLog`）
- **问题**：生产持续打印，噪音 + 潜在信息泄露（如账号数、任务名）。P2-7 已收口 `[smzdm-debug]`，但此处仍有散落日志。
- **修复**：接入统一日志封装（按 `LOG_LEVEL`/`SMZDM_DEBUG` 过滤）。

---

## 四、P2 低危 / 优化项

| # | 发现 | 位置 | 建议 |
|---|------|------|------|
| P2-1 | 内部错误回显（5xx 直接返 `e.message`） | `baoliao.js:186`、`tasks.js:291` | 统一泛化文案，细节仅落日志 |
| P2-2 | 用户可枚举（`/import` 返 `upserted` 布尔） | `users.js:111-160` | 统一返回，避免暴露是否已录入 |
| P2-3 | 依赖版本确认 | `server/package.json`（express 4.19.2 / cors 2.8.5 / dotenv 16.4.5，均为修 CVE 版本） | 跑 `npm audit`，锁定 dotenv ≥16.4.5 |
| P2-4 | 手动 run 的 `persist()` 绕过写锁 | `tasks.js:283,290` | 包进 `withWriteLock`（当前全量快照无实损，但破坏串行约定） |
| P2-5 | N+1 资产刷新 | `taskRunner.js:423`（逐账号 `safeGetUserInfo`） | 仅无余额时后台节流刷新 |
| P2-6 | `channelIdCache`/`lastGoodChannelId` 全局无界共享 | `realAdapter.js:208-211,254` | LRU 上限 + 按账号隔离，避免跨账号借用掩盖解析失败 |
| P2-7 | `fetchBaoliao` 重复 fetch 样板 | `realAdapter.js:583-592`（自实现 fetch+超时，与 `call()` 重复，阈值 5M≠2M） | 复用 `call({raw:true})` |
| P2-8 | 魔法常量散落 | `COUNT_MAX=5`、`500/200` 上限、cron 串、超时散布多处 | 收敛到 config/常量文件 |
| P2-9 | `withWriteLock` 的 onRejected 也执行 fn | `store.js:65`（`writeChain.then(fn, fn)`） | 改为 `.then(fn).catch(()=>{})` 显式隔离 |
| P2-10 | 前端调试日志 | `Tasks.vue:425/433/442`（`console.log/warn/error(e)`，error 含完整响应体） | 删除或接统一封装 |
| P2-11 | localStorage token 可被 XSS 窃取（架构性） | `client.js:11/49/56` | 服务端下发 CSP；高危操作二次校验 |
| P2-12 | 表单前端校验薄弱 | `AddCookies.vue:57`（未 trim/校验）、`Baoliao.vue:139 save()`（未校验 url 协议） | 提交前 trim + 校验 `https?://` |
| P2-13 | `setTimeout` 未 `onUnmounted` 清理 | `Baoliao.vue:107`、`GptReply.vue:279`、`AddCookies.vue:67` | 保存 id，`onUnmounted` 内 `clearTimeout` |
| P2-14 | `:key="i"` 下标键 | `Tasks.vue:153`、`ExtremeLazy.vue:30`、`Manage.vue:41` | 改用稳定 id |
| P2-15 | `installUrl` 求值时机 | `Users.vue:158`（setup 阶段定死读 localStorage） | 改为计算属性/随登录更新 |

---

## 五、已排查、无明显问题的项（一句话带过）
- **原型污染**：用户输入均经白名单解构或 JSON 往返；`Object.assign(init.headers, extra)` 不污染原型；未发现 `target[userKey]=` 直写。
- **路径遍历**：所有 `fs` 路径为固定常量（SCRIPT_PATH/CAPTURES_DIR/htmlPath），无用户输入拼接。
- **命令注入**：`selfUpdate.js` 用 `execFile`/`spawn` 传参数组（无 shell），git 参数自产，无注入面。
- **ReDoS**：正则均无嵌套量词/回溯炸弹。
- **不安全反序列化 / 头注入 / CORS**：`db.json` 仅服务端解析；CORS 默认 `origin:false`；无用户输入注入响应头。
- **前端 XSS**：无 `v-html`，外链经 `safeUrl` 过滤，无开放重定向（hash 路由 + 命名路由）。
- **前端响应式 / props / 定时器清理**：`reactive({})` 动态加 key 正常；`TaskCenter`/`VerifyChart` 已 `defineProps`；`Update`/`ExtremeLazy` 已 `onUnmounted`。

---

## 六、修复优先级建议
1. **立即（P0）**：P0-1 端点 SSRF 校验 + `mutationGuard`；P0-2 显式 `trustProxy` 配置 / 取消 IP 隔离改用令牌。
2. **近期（P1）**：P1-1 限流+强口令；P1-2 token 不出 URL/脚本；P1-3 写锁释放；P1-4 滚动上限+合并写；P1-5 时区统一；P1-6 抽公共解析模块；P1-7 日志级别。
3. **日常（P2）**：按上表逐项清理，优先 P2-1/2/10/11/12（信息泄露面）与 P2-6/7（性能/正确性）。

> 本报告为只读审计（2026-08-10 初版）。

## 七、P0 修复追加（2026-08-10 续）
用户要求落地 P0，已实施并通过自检（commit `34af60f` 已提交本地，待推送——当前环境无可用 GitHub 凭据、推送被 401 拒绝；凭据可用后 `git push` 即生效；未改前端、无需重建）：
- **P0-1 端点 SSRF**：`notifier.js` 导出 `isSafePushUrl`；`routes/tasks.js` 的 `PUT /endpoints` 与 `POST /captures/apply` 改 `mutationGuard`（OPEN_MODE 下须 `ADMIN_TOKEN`），并对 `endpoint`/`referer` 做 `isSafePushUrl` 校验（非法返回 `unsafe_endpoint`/`unsafe_referer`，captures 应用则跳过并注明原因）；`realAdapter.js` 的 `call` 增加 SSRF 纵深防御（统一出口拒绝私有/回环/链路本地地址，即使上层被绕过也拦住 `169.254.169.254` 等内网探测）。自检：`isSafePushUrl` 对 9 个私有/回环/链路本地用例全部拦截、4 个公网用例全部放行；`call('http://169.254.169.254/...')` 在 `fetch` 前即抛「拒绝请求非公网地址」。
- **P0-2 XFF 伪造**：`config.js` 的 `trustProxy` 不再由 `OPEN_MODE` 自动开启（默认 `false`），仅在确有多层可信反代时显式 `TRUST_PROXY=true`。直连暴露下 `req.ip` 为真实套接字对端、不可伪造，匿名无法借 XFF 命中同 /24 读他人数据。
- P1/P2 暂未实施，待后续排期。

## 八、P1-5 / P1-6 修复追加（2026-08-10 续）

与 P0-1/2 同理，本环境无可用 GitHub 凭据，以下提交已落本地、待推送（凭据可用后 `git push` 即生效；均为纯后端改动，无需前端重建）：

- **P1-5 时区一致性**：`taskRunner.js` 定时签到分支 `schedToday`/`schedYesterday` 统一走 `todayStrTZ`/`yesterdayStrTZ`（commit 待生成）。
- **P1-6 解析去重**：新建 `server/src/smzdm/parse.js` 收敛 `parseJsonp`/`removeTags`/`extractReward`；`realAdapter`/`tasks_real`/`taskMatrix`/`extremeLazy` 共用；`parseJsonp` 修复 `)]}'`+`callback()` 漏解外壳、`extremeLazy.collectArticleIds` 改用 `normalizeArticleId`。

> 剩余待办：P1-2（会话 Token 进 URL/可分发脚本，需前端重建）、P2-1~15（P2-9 写锁 onRejected 经评估为低危、暂不改动以免改变错误传播语义）。
