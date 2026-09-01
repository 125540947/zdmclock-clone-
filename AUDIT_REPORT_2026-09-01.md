# zdmclock-clone 当前状态代码审计报告

- **审计对象**：`zdmclock-clone`（什么值得买自动签到/好价克隆；后端 Node.js + Express 纯 ESM，前端 Vue3 + Vite）
- **审计日期**：2026-09-01
- **审计角色**：软件开发团队架构师（高见远）
- **审计性质**：增量 / 广角复核 —— 在历史批次 14/15（已闭环 29 项 H/M/L）之后，对**质量 / 性能 / 错误处理 / 技术债 / 重复代码 / 安全增量**六个维度作新一轮实地探查。
- **范围**：`server/src/**`、`web/src/**`、`config.js` / `.env.example` / `Dockerfile` / `docker-compose.yml`、`server/test/**`。排除 `node_modules`、`web/dist`、构建产物。
- **方法**：先 `Grep` + `Read` 实地逐文件核查，所有问题均锚定真实代码行号；安全基线项逐条回代码取证，未重新列入（见末节回归核对表）。

---

## TL;DR

> **共发现 12 项（严重 0 / 高 0 / 中 2 / 低 10）。**

代码库在经历批次 14/15（含 P0-1 SSRF、P0-2 XFF 伪造绕过网段隔离等）后**安全基线扎实，本次未发现新的严重 / 高危可利用漏洞**。本轮价值集中在**质量、性能、技术债、重复代码**维度的增量改进点，以及**一处需重点关注的重复代码引发的水平越权回归风险（A-01）**与**一处无界内存结构（A-02）**。

| 维度 | 数量 | 代表项 |
|---|---|---|
| 安全增量复核 | 0 新增严重/高 | 历史 H/M/L 均已在代码内闭环（末节核对表） |
| 代码质量 / 技术债 | 5 | A-01 重复可见性过滤、A-09 错误响应不一致、A-10 写锁样板重复 |
| 性能 | 2 | A-02 无界 `degradedWarned`、A-04 SPA 兜底每次重读文件 |
| 错误处理 | 1 | A-09 |
| 重复代码 | 2 | A-01、A-10 |
| 配置 / 运维 | 3 | A-06、A-07、A-08 |
| 测试覆盖 | 1（含 5 个薄弱点） | A-12 |

---

## 严重程度定义（本审计采用）

- **严重**：远程可利用 → 权限提升 / 数据泄露 / RCE / 必然崩溃。
- **高**：明显弱点或可致服务中断的配置/逻辑。
- **中**：质量 / 性能 / 可维护性缺陷，具真实影响（含"当前正确但易回归"的脆弱设计）。
- **低**：代码异味 / 轻微重复 / 可选加固。

---

## 问题清单（按严重程度降序）

### A-01 〔中 · 重复代码 / 技术债 / 潜在水平越权回归〕OPEN_MODE `/24` 网段可见性过滤在 4 处重复实现

**位置**
- `server/src/auth.js:291` `computeVisibleUserIds`（规范实现）
- `server/src/routes/baoliao.js:29-34`
- `server/src/routes/clock.js:25-36`（`scopeUserIds`）
- `server/src/routes/users.js:52`、`:68`

**描述**
OPEN_MODE 下"仅同 `/24` 网段录入的数据对匿名可见"这一核心隔离规则，在 4 个文件中各自用 `sameSegment(viewerIp, x.recordedIp, 24)` 内联重写，而非复用 `auth.js` 的规范函数：

```js
// routes/baoliao.js:33（与 clock.js:32、users.js:52/68 同构）
list = list.filter((x) => sameSegment(viewerIp, x.recordedIp, 24));
```

三处内联副本都自行 `if (config.openMode && !isAdminRequest(req))` 判断，逻辑当前与 `computeVisibleUserIds` 一致（均 24 位、均移除"无 recordedIp 遗留数据对匿名可见"特例），但**四份代码无共享抽象约束**。

**影响**
- 可维护性：规则变更（如改 `/32`、补 IPv6、调整遗留数据策略）须同步改 4 处，极易漏改。
- 安全回归风险：一旦任一内联副本漂移（例如误回退"无 recordedIp 即全部可见"），将重新打开**匿名跨网段读取他人好价/签到/账号数据**的水平越权通道（历史上 P0-3 / M-10 已修复过，正是此类重复导致的回归高发点）。

**修复建议**
抽取单一共享判定，使 4 处全部调用同一事实来源：

```js
// auth.js 新增
export function isRecordedIpVisibleToViewer(req, recordedIp) {
  if (isAdminRequest(req)) return true;
  if (!config.openMode) return true;
  if (!recordedIp) return false;            // M-10：遗留无归属数据不可见
  return sameSegment(getClientIp(req), recordedIp, 24);
}
```
`baoliao.js` / `clock.js` / `users.js` 的列表过滤改为 `list.filter(x => isRecordedIpVisibleToViewer(req, x.recordedIp))`，删除各自的内联副本；并补一条针对 `routes/baoliao.js`、`routes/clock.js` 列表接口的集成测试（见 A-12 T1）。

**工作量**：M（4 处重构 + 测试）

---

### A-02 〔中 · 性能 / 资源泄漏〕`realAdapter.degradedWarned` 为无界 `Set`

**位置**：`server/src/smzdm/realAdapter.js:293`、`:295-296`

**描述**
```js
const degradedWarned = new Set();           // :293 无容量上限
function warnDegradedChannel(articleId) {
  if (degradedWarned.has(articleId)) return;
  degradedWarned.add(articleId);            // :296 只增不减
  console.warn(...);
}
```
该 `Set` 以 `articleId` 为键，**仅 `.add` 从不淘汰**，随进程运行时间 + 处理的不同文章数单调增长。对照同文件的 `channelIdCache` 已实现 `CHANNEL_CACHE_MAX = 1000` 的 LRU 上限（`realAdapter.js:280-289`），此处缺同等约束，属明显的"无上界"反模式。

**影响**
长期运行（尤其每日对大量新好价执行评论/收藏/点赞）的实例，进程内存随唯一文章数持续增长；虽然单次增长温和，但属无回收的永久驻留，违背项目既有的"一切缓存有上限"约定。

**修复建议**
套用与 `channelIdCache` 一致的环形 / LRU 上限，或直接复用已存在的 `setChannelCache` 思路：
```js
const DEGRADED_WARN_MAX = 1000;
const degradedWarned = new Set();
function warnDegradedChannel(articleId) {
  if (degradedWarned.has(articleId)) return;
  if (degradedWarned.size >= DEGRADED_WARN_MAX) degradedWarned.clear(); // 或淘汰最旧
  degradedWarned.add(articleId);
  console.warn(...);
}
```
**工作量**：S

---

### A-03 〔低 · 性能 / 技术债〕`riskControl.state` Map 账号删除后不清理

**位置**：`server/src/riskControl.js:23`

**描述**
```js
const state = new Map(); // userId -> { fails, circuitUntil }
```
以 `userId` 为键。理论受 `MAX_USERS=500` 上界约束，但账号被删除时条目不主动 `delete`；长期 + 账号增删循环下缓慢累积且永不回收（无 LRU / 访问淘汰）。

**影响**：实际规模极小（≤ 用户数），不构成实质风险，但属"有状态结构缺生命周期管理"的轻微技术债。

**修复建议**：删除账号的路径（`routes/users.js` DELETE）中同步 `state.delete(userId)`；或在 `resolveRisk` 命中不存在的用户时惰性清理。
**工作量**：S

---

### A-04 〔低 · 性能〕SPA 兜底每次请求重读并正则重写 `index.html`

**位置**：`server/src/index.js:284-286`

**描述**
```js
app.get('*', (req, res) => {
  const htmlPath = path.join(config.webDist, 'index.html');
  fs.readFile(htmlPath, 'utf8', (err, html) => { ... }); // 每次请求重读 + 正则替换 nonce
```
SPA 兜底（非 `/api` 的 GET）每次都 `fs.readFile` + 正则注入 per-request CSP nonce。注意本前端使用 **hash history**（`createWebHashHistory`，`web/src/router/index.js:101`），路由切换不产生服务端回源，兜底仅在整页刷新 / 深链直访时触发，故非热路径；但仍是可避免的每请求 IO/CPU。

**影响**：低频，实测影响可忽略；纯"可优化"项。

**修复建议**：进程内缓存已盖章 HTML（资产名内容哈希、构建间不变），仅在启动 / `webDist` 变更时失效；nonce 仍需 per-request，可在缓存模板上做字符串替换而非重读文件。
**工作量**：S

---

### A-05 〔低 · 代码质量 / 魔法数字〕`gptDrafts` 上限 `200` 为行内字面量

**位置**：`server/src/taskRunner.js:374`

**描述**
```js
if (db.gptDrafts.length > 200) db.gptDrafts.length = 200; // R5：限制草稿上限
```
经核查：`db.gptDrafts.unshift(d)`（`:372`）把最新草稿置于头部，故 `.length = 200` 实际保留**最新 200 条**（非截断方向错误），行为与既有测试 `taskRunner.test.js:86` 一致，**非正确性 bug**。但 `200` 为裸字面量，与 `config.js` 中 `CLOCK_RECORDS_MAX_PER_USER` / `MAX_BAOLIAO_ITEMS` / `MAX_USERS` 等命名上限风格不一致，且未进入可配置项。

**影响**：可读性 / 可配置性轻微下降。

**修复建议**：提取 `const MAX_GPT_DRAFTS = 200;`（可纳入 `config.js` 的 `*_MAX` 体系），并同步更新测试断言引用。
**工作量**：S

---

### A-06 〔低 · 配置 / 运维〕`.env.example` 默认 `NODE_ENV=development`

**位置**：`.env.example:19`

**描述**
```env
NODE_ENV=development
```
后端仅在 `production` 才托管 `web/dist`（`index.js` 中 `NODE_ENV` 开关）。示例默认 `development` 意味着若运维照抄 `.env.example` 而不覆盖，服务"启动正常、接口可用"但**前端页面 404**（SPA 静态资源不被托管）。`docker-compose.yml` 已强制 `NODE_ENV=production`（:19），故仅裸部署 / 手动 `.env` 场景有此坑。

**影响**：部署可用性 footgun，非安全漏洞。

**修复建议**：示例默认值改为 `production`，或加醒目注释"生产务必 production，否则前端不托管"。
**工作量**：S

---

### A-07 〔低 · 安全纵深 / 配置〕好价 RSS 源默认明文 HTTP 且未走 SSRF 校验

**位置**：`.env.example:64`；`server/src/smzdm/rssFeed.js`（fetch 路径）

**描述**
```env
SMZDM_BAOLIAO_RSS_URL=http://feed.smzdm.com/
```
该源为明文 HTTP；且 RSS 抓取走通用 fetch，**未复用 `isSafeSmzdmUrl` / `assertPublicDns`（pinnedFetch）的 SSRF 校验**（对比 `notifier.js` 的推送 URL、`realAdapter.js` 的 Cookie 出口均有白名单）。当前该值为**管理员 env 配置（非用户输入）**，SSRF 风险低；但若未来允许前端/接口覆盖该 URL，则缺少与既有"对外请求一律白名单"策略同等的护栏。

**影响**：管理员可控输入，风险低；属纵深一致性缺口。

**修复建议**：① 读取处补 `assertPublicDns` / `isSafeSmzdmUrl` 式校验；② 示例默认改为 https 源，或显式标注"仅填可信源"。
**工作量**：S/M

---

### A-08 〔低 · 配置 / 文档〕跨站会话 Cookie 强制 `secure:true`，明文 HTTP 部署下静默失效

**位置**：`server/src/routes/auth.js:36-38`、`:52-55`

**描述**
```js
function sessionCookieOpts(req) {
  if (isCrossSiteRequest(req)) {
    // 跨站：SameSite=None 必须配合 Secure；跨站凭据 Cookie 也要求 TLS，故强制 secure。
    return { httpOnly: true, sameSite: 'none', path: '/', secure: true }; // :38 硬编码
  }
  return { ... secure: process.env.COOKIE_SECURE === '1' || (config.nodeEnv === 'production' && !!req.secure) }; // :44 条件
}
```
设计意图（注释明确）为"跨站凭据要求 TLS，故强制 Secure"——属 fail-closed 的**合理安全决策**，并非漏洞。但 `.env.example` / README 未明确告知：**跨站（不同源）登录流程必须 HTTPS**，否则 `Secure` Cookie 在 HTTP 下不会被浏览器存储，登录静默失效。这与同站分支（:44）的条件式 `secure` 在行为上不一致，易让运维困惑。

**影响**：无安全漏洞；仅为部署文档缺口，可能触发"跨域登录不起作用"的支持工单。

**修复建议**：在 `.env.example` 的 `CORS_ORIGIN` / 会话相关段补充"跨站认证需 TLS"说明；保持 :38 的 fail-closed 行为（不改为条件式，避免跨站明文泄露凭据）。
**工作量**：S

---

### A-09 〔低 · 错误处理 / 一致性〕错误响应契约不统一

**位置**：`server/src/wrapAsync.js`（全局兜底 500）；`server/src/routes/baoliao.js:44+`（`try/catch` 吞错返回 200）；`server/src/taskRunner.js`（返回 `{ ok:false, error }`）

**描述**
- `wrapAsync` 正确将 async 拒绝转交 Express 默认 500 兜底（`:6-11`），避免请求挂起——良好。
- 但部分路由内部 `try/catch` 吞掉异常并以 **HTTP 200 + `message` 含错误文本**返回（如 `baoliao refresh`），而 `taskRunner` 体系以 **`{ ok:false, error }`** 结构化字段表达失败。两套语义并存：调用方（前端 / 自动化）需同时处理"HTTP 200 但 ok=false"与"HTTP 500 + message"，易歧义。

**影响**：消费方需做双重判断，错误分类 / 可观测性下降；无直接安全影响。

**修复建议**：定义统一错误信封 `{ ok, error, message }` 与对应 HTTP 状态码映射，路由内部 catch 也走同一信封而非裸 200。
**工作量**：M

---

### A-10 〔低 · 重复代码〕路由 CRUD 的"写锁内重定位"样板重复

**位置**：`server/src/routes/users.js` 等多条写路由（模式：`await withWriteLock(() => { ...; persist(); })` 或 `persistAwait`）

**描述**
多条写路由重复"修改内存对象 → 进入写锁 → 落盘"的样板，存在**遗漏 `persist`/`persistAwait`** 的潜在不一致风险（历史曾因 `health.js` 漏 `persistAwait` 导致 `POST /api/health/cookies` 有账号时 500，已修复）。

**影响**：样板重复，易在新增路由时漏写持久化。

**修复建议**：抽取 `mutateDb(fn)` 辅助统一"修改→落盘"语义，降低遗漏概率。
**工作量**：M

---

### A-11 〔低 · 前端 / 数据安全〕`GptReply.vue` 将 GPT 配置写入 `localStorage`

**位置**：`web/src/views/GptReply.vue:146`、`:153`

**描述**
```js
const s = JSON.parse(localStorage.getItem(KEY) || '{}'); // :146
localStorage.setItem(KEY, JSON.stringify(cfg.value));     // :153
```
GPT 配置（apiBase / 模型 / 是否启用等标记）被存于 `localStorage` 并在加载时 `JSON.parse`。当前密钥经后端代理、不落前端，故**非凭证明文泄露**；但同源 XSS / 恶意扩展可读取这些配置，且属"本可仅留服务端"的多余落盘。

**影响**：低；敏感凭据不在此处，仅为配置暴露面。

**修复建议**：前端仅持"已配置 / 未配置"标记，完整配置存服务端；或至少对 localStorage 内容做来源校验。
**工作量**：M

---

### A-12 〔低 · 测试覆盖〕测试薄弱点（5 项，见下节）

**位置**：`server/test/**`、`web/src/**`（前端零自动化测试）

**描述与明细见「测试覆盖薄弱点」一节。**

---

## 安全回归核对表（历史基线，本次逐条回代码取证）

下列为团队 lead 指定"视为已修复、不重新列入"的基线项；本轮均已在当前代码中确认落实：

| # | 基线项 | 状态 | 证据（`file:line`） |
|---|---|---|---|
| 1 | OPEN_MODE 网络隔离（/24 网段） | ✅ 已落实 | `auth.js:291` `computeVisibleUserIds`；`auth.js:309` `canAccessUser`（M-10 移除遗留账号特例） |
| 2 | `mutationGuard`（写操作 X-Admin-Token / authRequired） | ✅ 已落实 | `auth.js:274-285`（开放模式走 `requireAdmin`，非开放走 `authRequired`） |
| 3 | `isSafeSmzdmUrl` SSRF 白名单 | ✅ 已落实 | `notifier.js:23-39`（仅 smzdm.com 及其子域；阻断私有/回环/链路本地/元数据 IP） |
| 4 | `getClientIp` 走 proxy-addr（`req.ip`，H-04 XFF 伪造修复） | ✅ 已落实 | `auth.js:114-115`（`return (req && req.ip) \|\| ''`） |
| 5 | `parseBool` fail-closed（H-03） | ✅ 已落实 | `config.js:11-18`（未识别值回退默认 `d`，如 `tru` 笔误不再静默关鉴权） |
| 6 | 限流器 key=网络层 `req.ip`（不可伪造）+ LRU 5000 | ✅ 已落实 | `rateLimit.js:20`（`key = req => req.ip`）、`:24`（`maxEntries=5000`）、`:50-52`（淘汰） |
| 7 | HttpOnly 会话 Cookie（#190） | ✅ 已落实 | `routes/auth.js:38`、`:41`、`:54`（`httpOnly: true`） |
| 8 | 隐藏 `X-Powered-By` | ✅ 已落实 | `index.js:139`（`app.disable('x-powered-by')`） |
| 9 | realAdapter DNS 重绑防护（pinnedFetch + assertPublicDns） | ✅ 已落实 | `dnsGuard.js:92` `assertPublicDns`、`:125` `_pinnedRequest`、`:213` `pinnedFetch` |

> 结论：9 项历史修复**全部在当前代码中仍有效**，未发现回退。

---

## 修复路线图（按批次）

**批次 A — 立即可做、低风险（建议随下一轮小重构合并）**
- A-02 无界 `degradedWarned` 加 LRU / 环形上限（S）
- A-03 `riskControl.state` 账号删除时清理（S）
- A-04 SPA 兜底 HTML 进程内缓存（S）
- A-05 `MAX_GPT_DRAFTS` 命名常量（S）
- A-06 `.env.example` 默认 `production`（S）
- A-08 跨站会话需 TLS 的文档说明（S）

**批次 B — 需设计 / 测试，中等风险**
- A-01 抽取 `isRecordedIpVisibleToViewer` 统一 4 处可见性过滤（M，核心项）
- A-07 RSS 源补 SSRF 校验（S/M）
- A-09 统一错误响应信封（M）
- A-10 抽取 `mutateDb` 写锁样板（M）
- A-11 GPT 配置移出 localStorage（M）

**批次 C — 测试补强（对应 A-12）**
- 补齐下列 5 个薄弱点的专项测试（见下）

---

## 测试覆盖薄弱点（A-12，5 项）

> 后端测试套件规模可观（41 个测试文件，历史基线全绿），但下列维度仍薄弱：

1. **T1 · 路由内联可见性过滤器无专项测试（关联 A-01）**
   `authSecurity.test.js` 覆盖了 `auth.js` 的 `computeVisibleUserIds` / `canAccessUser`，但 **`routes/baoliao.js:29-34`、`routes/clock.js:25-36` 的内联 `/24` 过滤未被任何测试触碰**。这正是 A-01 的回归高发点——若内联副本漂移，现行测试不会报警。建议新增针对这两个列表接口的"开放模式匿名跨网段应被过滤"集成断言。

2. **T2 · 前端零自动化测试**
   `web/src` 无测试目录。路由守卫（`router.beforeEach` 基于 `session.isAdmin`）、`session.js` 响应式鉴权、`GptReply.vue` 的 localStorage 逻辑（A-11）全靠人工验证。建议至少补 `router` 守卫与 `session` 的单元/组件测试。

3. **T3 · 无界结构缺上界/清理测试（关联 A-02 / A-03）**
   `realAdapter.degradedWarned`（A-02）与 `riskControl.state`（A-03）无"达上限 / 账号删除后清理"的断言；对照 `realAdapterNet.test.js:268` 已对 `channelIdCache` 上限有测试，二者应补齐同等覆盖。

4. **T4 · 自定义端点 SSRF 校验缺专项断言**
   `taskMatrix.runCustomEndpointTask` 对自定义端点 URL 走 `isSafeSmzdmUrl` 白名单，但 `taskMatrix.test.js` 主要覆盖内置端点（lottery/turntable/dailyTasks）。建议补"自定义端点配置为非 smzdm 域时被拒"的断言，与 `notifier.test.js` 的 `isSafePushUrl` 覆盖对齐。

5. **T5 · 错误响应契约缺一致性测试（关联 A-09）**
   无测试断言"HTTP 200 + `ok:false`"与"HTTP 500 + message"的区分是否被调用方正确消费；建议补契约测试，固化统一错误信封（待 A-09 落地后）。

---

## 附录：本次实地核查覆盖的文件

- 后端（全部 `server/src/**` 共 26 个源文件 + `routes/*` 11 个 + `middleware/*`、`smzdm/*` 8 个）：`index.js`、`config.js`、`auth.js`、`store.js`、`taskRunner.js`、`taskMatrix.js`、`clockCore.js`、`clockSchedule.js`、`taskRunLog.js`、`assetLedger.js`、`riskControl.js`、`notifier.js`、`dnsGuard.js`、`gptAdapter.js`、`scheduler.js`、`selfUpdate.js`、`verifyRealMode.js`、`wrapAsync.js`、`log.js`、`startup.js`、`health.js`、`validation.js`；`routes/{admin,assets,auth,baoliao,clock,gpt,health,notify,tasks,update,users}.js`；`smzdm/{adapter,mockAdapter,realAdapter,parse,articleId,rssFeed,tasks_real}.js`；`middleware/rateLimit.js`。
- 前端：`web/src/router/index.js`、`web/src/views/GptReply.vue`，及全局 XSS 探针（`v-html` / `innerHTML` / `eval` / `new Function` → **0 命中**，前端无脚本注入面）。
- 配置 / 部署：`.env.example`、`Dockerfile`、`docker-compose.yml`（二者均正确绑定 `127.0.0.1`，无 `0.0.0.0` 公网暴露）。
- 测试：`server/test/**` 41 文件，及测试覆盖抽样（`authSecurity.test.js`、`taskRunner.test.js`、`realAdapterNet.test.js`、`notify.test.js`、`taskMatrix.test.js`、`securityHeaders.test.js`）。
