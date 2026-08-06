# 功能性测试覆盖审查报告（zdmclock-clone）

> 审查日期：2026-08-06
> 审查范围：server 全量源码 23 模块 + web 前端 22 文件
> 测试运行器：`node --test`（Node 内置，**无** vitest / jest / mocha / supertest）
> 实测结果：`server/test/clockCore.test.js` 共 **8 个用例，全部通过（pass 8 / fail 0）**；前端测试文件数 **0**

---

## 1. 执行摘要

| 维度 | 现状 |
|------|------|
| 测试文件数 | 1（`server/test/clockCore.test.js`） |
| 已测用例数 | 8（全绿） |
| 被测模块占比 | 1 / 23 ≈ **4.3%** |
| 路由层覆盖率 | **0%**（9 个路由模块全部无测试） |
| 数据持久层（store） | **0%** 直接测试（仅经 applyClock 间接触及内存） |
| 任务/调度核心 | `cronMatch` 求值 **0%** 测试；`taskRunner` 全模块 **0%** |
| 安全逻辑 | `safeEqual` / `authRequired` / `maskCookie` **0%** |
| 适配器 | mock/real 适配器逻辑 **0%**；`normalizeArticleId` 已覆盖 ✅ |
| 前端 | 22 个源文件，**0** 测试 |

**结论**：现有测试仅覆盖了"纯内存、无 I/O 副作用"的少数纯函数（`applyClock` 幂等、`withWriteLock` 串行化、`validateCron` 语法、`normalizeArticleId`）。**所有涉及 I/O 的真实业务路径——HTTP 路由、数据库持久化、网络适配器、推送通知、多账号聚合、cron 求值——均无测试保护**。一旦这些逻辑被修改（如第七轮审计所揭示的 A1–A7 类问题），回归风险完全裸露。

---

## 2. 已实现的测试用例清单（8 条）

全部位于 `server/test/clockCore.test.js`：

| # | 用例 | 覆盖函数 | 验证点 |
|---|------|----------|--------|
| 1 | `applyClock 首次签到写入记录并更新统计` | `clockCore.applyClock` | 首签：写记录、points/totalClockIn/streak 各 +1 |
| 2 | `applyClock 同日重复签到幂等（不重复计）` | `applyClock` | 同日重复：duplicate=true、不重复累加、streak 不变 |
| 3 | `applyClock 昨日有记录时 streak 递增` | `applyClock` | 有昨日记录：streak 从 0 → 1（注意：非 +1 校验边界，见 §5） |
| 4 | `withWriteLock 串行执行（后调用等待先调用完成）` | `store.withWriteLock` | Promise 链串行化，避免并发 lost-update |
| 5 | `withWriteLock 返回值的决议值透传` | `withWriteLock` | 返回值经锁透传 |
| 6 | `validateCron 合法表达式` | `scheduler.validateCron` | 5 段合法：标准 / */n / a-b / a,b,c |
| 7 | `validateCron 非法表达式被拒绝（b3）` | `validateCron` | 4 段 / 6 段 / 空 / 分超范围 / 逆序区间 / 非数字 / 缺段 全部 false |
| 8 | `normalizeArticleId 提取文章 ID` | `smzdm/articleId` | 纯数字、/p/、/articles/、空白、非链接 各分支 |

---

## 3. 未被覆盖的功能点（按模块分组）

### 3.1 数据层 `store.js`（核心持久化，0% 直接测试）
- `load()`：① 首次启动创建默认库并 `persist()`；② JSON 解析失败备份为 `.corrupt-<ts>`（R3）后重置；③ 旧库字段补全（`articleId`/`articleSource`/补 `t_gpt`/`t_fetch`/`settings.gpt`/`settings.push` 合并）；④ 数组化兜底（baoliao/gptDrafts）。
- `persist()`：`.tmp` + `renameSync` 原子写；`cache` 未初始化防御（直接 return）。
- `genId(prefix)`：ID 格式 `"<prefix>_<time36><rand>"`。
- `mergeBaoliao(items)`：**好价抓取去重核心**——① cache 未初始化返回 0；② 非数组返回 0；③ 仅接受 http(s)（非链接过滤）；④ 按 `smzdmUrl`/`url` 去重跳过；⑤ 字段长度钳制（title 200 / url 2000 / price 50 / content 2000）；⑥ 超 500 截断（R5）。**全部无测试。**
- `localDateStr` / `todayStr`：本地时区日期格式、跨月/跨年边界（`applyClock` 间接依赖，但无直接测试）。

### 3.2 鉴权与安全 `auth.js`（0% 测试，安全关键点）
- `safeEqual(a,b)`：恒定时间比较——不同长度返回 false、相等返回 true、`undefined/null` 处理。
- `authRequired(req,res,next)`：`REQUIRE_AUTH=false` 直接放行；`true` 时 `Bearer` token 经 `safeEqual` 校验，失败 401。
- `maskCookie(cookie)`：空 → ''，非空 → '已保存(已隐藏)'。

### 3.3 配置 `config.js`（0% 测试）
- `bool(v,d)` 真值集合（`1/true/yes/on`）与 undefined 默认；`port`/`nodeEnv` 解析；默认随机 `apiToken` 治理（`apiTokenIsDefault`）。

### 3.4 路由层（9 模块，0% 测试）
- `routes/auth.js`：`POST /login` 正确凭证签发 `token`、错误凭证 401。
- `routes/users.js`：`GET /`（cookie 遮罩列表）、`POST /`（cookie 必填 400、长度钳制 S9）、`GET/PUT/DELETE /:id`（404、换 cookie 刷新资料）、`GET /:id/smzdm`、`POST /:id/refresh`。
- `routes/clock.js`：`/status`、`/history`（分页钳制 b2，上限 200）、`/do`（无用户 400、签到失败 502、重复 409、adapter 异常 502、`buildCalendar` 日历构造）。**用户核心场景，零测试。**
- `routes/tasks.js`：`GET /`、`PUT /:id`（cron 非法 400、articleId 长度 >512 400、articleSource 非法 400、source 非法 400、limit 1~50 越界 400）、`POST /:id/run`（无任务 404、失败 400、adapter 异常 502）。
- `routes/baoliao.js`：`GET /`（排序+`userId` 过滤）、`POST /refresh`（limit 钳制 1~50、无 items 502、catch 502）、`POST /`（标题空 400）、`PUT/DELETE /:id`（404）、`POST /:id/submit`（无用户 400、adapter 异常 502、**路由顺序**：`refresh` 必须在 `/:id` 之前）。
- `routes/gpt.js`：`/status`、`/config`（GET/PUT 校验 target∈{comment,message,all} 400、tone∈{friendly,pro,humor} 400、prompt >2000 400）、`/drafts`、`/drafts/:id`、`/reply`（gpt 未启用 400、未配置 400、adapter 异常 502）。
- `routes/notify.js`：`/config`（GET/PUT channel 校验）、`/test`（channel=none 400、未配置令牌 400）。
- `routes/admin.js`：`/stats`（统计聚合：todayClocks、recent Top10、enabledTasks 计数）。

### 3.5 适配器层（0% 测试）
- `smzdm/adapter.js`：`config.smzdmAdapter==='real'` → realAdapter 选择逻辑。
- `smzdm/mockAdapter.js`：`getUserInfo`/`doClockIn`/`doComment`/`doFavorite`/`doPoint`/`submitBaoliao`/`fetchBaoliao`（纯函数，易测）。
- `smzdm/realAdapter.js`：`call()` 超时（b 超时封装）、响应体 >2MB 拒绝（b5）、`)]}'` 前缀解析、`assertOk` 错误码判定（error_code/code/success）、`md5Sign`、各动作 articleId 缺失抛错。**可离线以 mock `fetch` 测试的关键解析/签名逻辑，目前零覆盖。**
- `smzdm/articleId.js`：`normalizeArticleId` **已覆盖 ✅**（用例 8）。

### 3.6 任务 / 调度（0% 测试，自动化核心）
- `scheduler.js`：`cronMatch`（**真实求值**，覆盖 `*` / `*/n` / `a-b` / `a,b,c` 各分支、周 0–6、月末跨月）、`fieldMatch`（step≤0 返回 false、`a-b` 区间、单值匹配）、`validateField`（逆序区间 a>b 返回 false、空段 false）、`tick()`（`lastFiredMinute` 同分钟去重、b6 异常捕获不中断循环、minuteKey 计算）、`start/stopScheduler`。**`cronMatch` 是调度能否触发的根本，仅有 `validateCron` 测试，求值逻辑零覆盖。**
- `taskRunner.js`：`collectArticleIds`（baoliao 来源提取+去重、manual 覆盖优先级）、`runEngagement`（no_article 错误、baoliao 每篇 1 次 / manual 用 count、perUser 聚合、partial 判定）、`runClockForUser`（duplicate 处理）、`runGptBatch`（gpt_disabled、no_source、autoPost 发布、草稿上限 200、gen_all_failed）、`runFetch`（fetch_failed、no_items、added 去重计数）、`resolveUsers`（指定 userId / 全账号）。**多账号自动化业务逻辑，零测试。**

### 3.7 通知 `notifier.js`（0% 测试）
- `resolvePushSettings(db)`：env 回退、enabled 判定（UI 开启 或 env 已配）。
- `sendPush`（各渠道）：`channel_none`、serverchan/bark/telegram/webhook 的 missing_token/webhook 返回 `{ok:false}`、超时捕获、HTTP 失败处理。**不抛异常是契约，零测试。**

### 3.8 大模型 `gptAdapter.js`（0% 测试）
- `buildSystemPrompt({tone,prompt})`：tone 映射（friendly/pro/humor 默认）、custom prompt 拼接。
- `generateReply`：未配置抛错、空文本回退 `'你好'`、HTTP 错误、空内容抛错。

### 3.9 入口 `index.js`（0% 测试，集成范畴）
- CORS 默认 `origin:false`、健康检查 `/api/health`、生产托管静态、`S10` 错误兜底（生产不暴露内部错误）、启动安全告警（REQUIRE_AUTH / apiToken / adminPassword 默认）。

### 3.10 前端 `web/src`（22 文件，0% 测试）
- `api/client.js`：前后端契约关键（token 注入、错误解析），无测试。
- 21 个 Vue 视图（ClockCenter / TaskCenter / Baoliao / GptReply / Notify / Users / Admin 等）+ `App.vue` + `router`：无快照/交互测试。

---

## 4. 关键用户场景覆盖对照

| 关键场景 | 是否被测试 | 备注 |
|----------|-----------|------|
| 手动签到（含幂等/连续天数） | 部分（内存逻辑） | 路由 `/do` 的 HTTP 路径、409/502 分支未测 |
| 自动每日签到（调度触发） | 否 | `cronMatch` 求值 + `tick` 未测 |
| 多账号批量遍历签到 | 否 | `runTask`/`resolveUsers` 未测 |
| 好价抓取去重入库 | 否 | `mergeBaoliao` 未测 |
| 评论/收藏/点赞执行 | 否 | `runEngagement` 未测 |
| GPT 批量生成草稿 | 否 | `runGptBatch` 未测 |
| 推送通知各渠道 | 否 | `sendPush` 各分支未测 |
| 登录鉴权 | 否 | `/login` + `authRequired` 未测 |
| 账号 CRUD | 否 | `users.js` 全部路由未测 |
| 任务配置校验 | 否 | `tasks.js` PUT 各校验分支未测 |
| 前端渲染/契约 | 否 | `client.js` + 视图未测 |

---

## 5. 边界条件覆盖差距

- **`applyClock` 断签重置**：代码 `streak = hasYesterday ? streak+1 : 1`，断签（前天有记录但昨天无）应重置为 1；现有用例只覆盖"昨日有记录→+1"和"首次→1"，**未覆盖"断签"边界**。
- **`withWriteLock` 错误路径**：`.then((),())` 错误继续链的逻辑未测（仅测正常返回）。
- **`mergeBaoliao` 上限截断**：>500 丢弃最旧，未测。
- **`cronMatch` 月末/跨月/周几**：求值未测，仅测语法。
- **`store.load` 旧库迁移与损坏恢复**：未测（R3 备份、字段合并）。
- **分页钳制 b2**：`/history` 的 `pageSize` 上限 200，未测。
- **路由顺序**：`baoliao.POST /refresh` 必须早于 `/:id`，结构性约束无测试保护。

---

## 6. 测试完整性差距分析

1. **覆盖广度极低**：23 个模块仅 1 个有测试，关键业务/I/O 路径 0 覆盖。
2. **仅纯函数，无 I/O 测试**：所有"会真正读写/请求"的逻辑（路由、持久化、网络、推送）未受保护，而这正是第七轮审计 A1–A7 缺陷集中发生的层面。
3. **无集成/契约测试**：前后端契约（`api/client.js`、响应字段形状如 `data.list` vs `data.users`——曾是第 A3 缺陷）无测试固化。
4. **无错误/异常路径**：除 `validateCron` 与 `applyClock` 幂等，绝大多数错误分支（400/404/409/502）未测。
5. **安全逻辑裸奔**：`safeEqual`/`authRequired`/`maskCookie` 零测试，隐含侧信道/越权回归风险。
6. **缺测试基础设施**：无 supertest；路由测试需自行 `app.listen` 临时端口 + `fetch`，或引入轻量 HTTP 断言工具。

---

## 7. 建议补充的测试范围（按优先级）

### P0 — 高价值、低风险、纯函数（建议立即补，不依赖 I/O）
- `mergeBaoliao`：去重、过滤非 http、字段钳制、>500 截断、非数组/cache 空返回 0。
- `auth.safeEqual`：不同长度 false、相等 true、undefined 处理。
- `config.bool`：真值/假值/undefined 默认。
- `scheduler.cronMatch` + `fieldMatch`：`*/n`、`a-b`、`a,b,c`、越界、周 0–6、月末跨月。
- `gptAdapter.buildSystemPrompt`：tone 默认、custom 拼接。
- `taskRunner.collectArticleIds`：baoliao 去重 / manual 覆盖优先级。
- `taskRunner.resolveUsers`：指定 userId / 全账号。
- `applyClock` 补：断签重置为 1 的边界用例。

### P1 — 路由层（需轻量 HTTP 测试，建议用临时端口 + fetch 或引入 supertest）
- `routes/auth` /login 成功/失败。
- `routes/users` 新增 cookie 必填 400、长度钳制、404。
- `routes/tasks` PUT：cron 非法 400、limit 越界 400、source 非法 400。
- `routes/clock` /do 无用户 400、重复 409；/history 分页钳制。
- `routes/baoliao` /submit 无用户 400；/refresh 无 items 502；路由顺序。
- `routes/gpt` /reply 未启用/未配置 400；`routes/notify` /test channel none/未配置 400。

### P2 — 集成/错误路径/边界
- `store.load`：默认库创建、`.corrupt` 备份、旧库字段合并、limit 钳制。
- `taskRunner.runEngagement`：no_article、partial 聚合；`runGptBatch`：gpt_disabled/no_source/autoPost/草稿上限；`runFetch`：no_items/去重 added。
- `notifier.sendPush` 各渠道 missing 返回、`resolvePushSettings` env 回退。
- `realAdapter.call`：超时/b5 超大响应/`)】}'` 解析/`assertOk` 错误码（以 mock `fetch` 离线测试）。
- `scheduler.tick`：`lastFiredMinute` 去重、b6 异常捕获。

### P3 — 前端 / 全链路
- `web/src/api/client.js`：token 注入、错误解析契约。
- 关键视图交互/快照（按需）。

---

## 8. 结论

现有测试提供了"内存逻辑层"的底线保障，但对一个以**自动化签到/抓取/推送**为核心、且经历过 A1–A7 类运行期缺陷的项目而言，**业务路径与 I/O 路径的测试几乎为空**。建议以 P0 纯函数用例快速拉起防护网（约 1–2 天），再逐步补全 P1 路由层与 P2 集成测试。在补齐 P0–P1 前，任何对 `store`/`routes`/`taskRunner`/`scheduler`/`notifier` 的修改都应配合人工冒烟，否则回归风险不可控。

> 注：本报告仅作覆盖性审查，未改动任何源码或新增测试文件。如需，可基于 P0 清单直接生成对应测试。
