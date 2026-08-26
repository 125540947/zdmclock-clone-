# zdmclock-clone 独立复核报告（架构 + 代码质量 + 安全态势）
- **评审日期**：2026-08-26
- **评审范围**：`server/src/`（Node.js + Express，纯 ESM）与 `web/src/`（Vue3 + Vite）
- **当前 HEAD**：`89231c1`（fix(security): 隐藏 X-Powered-By）
- **部署**：VPS `124.222.218.174:3000`
- **方法**：仅评审，不修改；逐文件 Read/Grep 实际核对，每条发现附 `文件:行号` 证据
- **基线**：此前一轮深度审计（7 HIGH + 17 MED + 5 LOW 共 29 项），本轮验证修复是否真实落地并查找新风险

---

## TL;DR（一句话总评）
此前安全审计的全部关键修复（隐藏 X-Powered-By、不信任 XFF、`mutationGuard` 写路由全覆盖、容量上限、自更新事务回滚、HttpOnly token、SSRF DNS 重绑定 IP 钉死）在 `89231c1` **均真实落地且比审计描述更完善**；架构分层清晰、依赖方向基本单向、测试覆盖良好（44 个测试文件）；**新发现以可维护性问题为主**——`gpt.js` 文件编码损坏（GBK/UTF-8 不一致）、`admin.js` 与 `clock.js` 约 120 行处理函数逐字重复、`taskRunner↔startup` 循环依赖、SPA 兜底对未知 API GET 返回 HTML；**无新增高危安全回归**。

---

## 一、架构评估

### 1.1 分层与依赖方向（实测 import 图）
```
config.js  (只读配置，模块加载期做 fail-closed/致命校验)
   ↑
store.js   (数据层单例 + 写串行化 withWriteLock/persist 链)   ← 被 20+ 模块引用
   ↑
auth.js    (鉴权原语：safeEqual/getClientIp/mutationGuard/computeVisibleUserIds…)
   ↑
routes/*   (HTTP 层，复用 auth 原语与 store)
scheduler.js → taskRunner.js → {clockCore, startup, smzdm/adapter, gptAdapter, assetLedger}
smzdm/adapter → {mockAdapter, realAdapter(dnsGuard+notifier), taskMatrix, tasks_real}
```
- 依赖方向**基本单向、自底向上**，无恶化的全局环形依赖（仅 `taskRunner ↔ startup` 一处惰性循环，见 §3）。
- `store.js` 是中枢数据层，`auth.js` 是鉴权原语层，职责边界清晰，符合分层直觉。

### 1.2 模块边界与耦合
- **清晰点**：`store`（持久化/查询）、`auth`（鉴权/网段/可见性）、`selfUpdate`（受控更新）三个横切模块被各路由干净复用；`dnsGuard` 把「白名单 + DNS 重绑定钉死」收敛为单一 `pinnedFetch` 出口（`realAdapter.js:149`、`notifier.js:262` 均复用），未扩散。
- **"大模块耦合"现状**：`taskRunner.js` 是中枢编排器，扇入高（clock/startup/comment/favorite/point/gpt/ledger/smzdm 皆经其手），职责偏多。当前可控，但属后续最该拆分的模块（按任务类型抽子编排器）。
- **隐式全局可变状态**：`store.cache` 单例（全应用共享的内存库）+ `scheduler.js` 模块级 `timer/lastFiredMinute/lastHealthMinute/lastUpdateCheckMinute` + `update.js` 模块级 `applyJob/lastCheck`。单机进程内部可接受，但属「隐式共享可变状态」，测试需靠 `load()` 缓存重置来隔离。

### 1.3 循环依赖
- `taskRunner.js:8` 导入 `startup.js` 的 `runStartupForAccounts`；`startup.js:15` 导入 `taskRunner.js` 的 `runTask`。二者均为**函数级惰性引用**（在别的函数体内调用），ESM 可正常解析，`node --check` 通过，非运行时缺陷，仅代码气味（见 §3 P2）。

---

## 二、代码质量发现

| 严重度 | 文件:行 | 现象 | 建议 |
|---|---|---|---|
| **P1** | `server/src/routes/admin.js:13-156` 与 `server/src/routes/clock.js:13-156` | **逐字重复**：`/stats`、`/clock-distribution`、`/risk-settings` 三套 handler 在两文件完全相同（约 120 行）。两路由分别挂载于 `/api/admin` 与 `/api/clock`，逻辑双份。 | 抽取共享 handler 工厂（如 `makeStatsHandler()`），两路由复用；消除后双份逻辑漂移风险。 |
| **P1** | `server/src/routes/gpt.js`（整文件） | **文件编码损坏**：非标准 UTF-8（经 GBK 解码可读，但严格 UTF-8 解析器报 `invalid continuation byte`，首段非 ASCII 字节 `e6 9c 8d` 区）。`node --check` 因 V8 宽松仍通过、线上可运行，但 git diff / GitHub / 默认 UTF-8 IDE 均显示乱码（Read 工具中该文件中文注释即呈乱码，其余文件正常）。 | 立即 `iconv -f GBK -t UTF-8` 重存为 UTF-8；加 `.editorconfig`(`charset=utf-8`) + 编辑器/CI 编码校验，避免后续 UTF-8 编辑器保存时真正破坏文件。 |
| **P2** | `server/src/taskRunner.js:8` ↔ `server/src/startup.js:15` | **循环依赖**（惰性、无运行时错误，但增加理解成本、阻碍单测）。 | 将共享的 `runTask`/`runStartupForAccounts` 抽到独立编排模块，或令 `startup` 仅作为 `taskRunner` 内的一个分支，打破环。 |
| **P2** | `server/src/index.js:279`（`app.get('*', …)` SPA 兜底） | 该兜底**吞掉所有未匹配 GET**（含未知 `/api/*` 路径），返回 `200 HTML` 而非 `404 JSON`。可能掩盖前端误调用的 API 404、干扰监控/错误判定。 | 在兜底前加 `app.use('/api', (req,res)=>res.status(404).json({error:'not_found'}))`，明确区分 API 与前端路由。 |
| **P2** | `server/src/store.js:356`（`mergeBaoliao` 容量截断） | 单批导入即超 `maxBaoliaoItems` 时**静默截断最旧**，前端 `bulk` 仍报 `added` 数，与「已达上限」语义略有出入（设计取舍，非缺陷）。 | 可选：在 `bulk`/POST `/` 到达上限时返回 `207` 或显式提示，而非合并后静默截断。 |
| **P2**（命名/重复） | `server/src/config.js` 已收敛魔法常量（`maxNoteLen` 等），但 `web/src` 与 server 间仍存在少量阈值重复（如 baoliao 批量 `MAX_IMPORT_ITEMS` 在 `validation.js` 定义，前端另有默认）。 | 轻微一致性损耗。 | 跨端共享常量可经 `validation.js` 导出或 `.env` 统一，非紧急。 |

**死代码 / 过度工程**：整体克制，未发现明显死代码或过度抽象；`safeEqual`/`parseCookies` 等为零依赖必要实现，符合项目「避免新增依赖」约定。未见 `eval`/动态 `require`/路径遍历（读文件均用固定 `SCRIPT_PATH`/`captures/detected.json`/`webDist/index.html`，无用户输入拼路径）。

---

## 三、安全复核结论

### 3.1 此前审计关键修复 —— 逐项确认已落地
| # | 审计项 | 代码证据 | 结论 |
|---|---|---|---|
| 1 | H-01 XFF 伪造 / trust proxy | `auth.js:114-116` `getClientIp` 仅返回 `req.ip`，全程不解析 XFF 最左段；`index.js:144` trust proxy 绑定受信网段 `config.proxyTrustedSubnet` | ✅ 落地 |
| 2 | H-02/H-04 Host 注入 / 回传地址 | `users.js:198-236` `bakeImportScript` 优先 `PUBLIC_BASE_URL`，回退时校验 `hostAllowlist`；拒绝不可信 Host | ✅ 落地 |
| 3 | P0-2/P0-3 水平越权 / 同网段隔离 | `auth.js:291-317` `computeVisibleUserIds`/`canAccessUser`；M-10 已移除「无 recordedIp 遗留账号全可见」特例（`users.js:48-58` `rejectHiddenAccount`） | ✅ 落地 |
| 4 | 开放模式鉴权 | `auth.js:274-277` `mutationGuard` 在开放模式强制 `requireAdmin`；`auth.js:90-108` login 不再向匿名泄露 `ADMIN_TOKEN` | ✅ 落地 |
| 5 | 写路由并发安全（M-10 等） | **全部写路由**均在 `withWriteLock` 内完成「定位+改写+persistAwait`：baoliao(`PUT/DELETE/submit/refresh`)、users(`PUT/DELETE`)、tasks(`PUT/:id`/`POST/:id/run`/`PUT/endpoints`/`POST/captures/apply`)、clock(`POST/do`)、gpt(`PUT/config`/`DELETE/drafts/:id`/`POST/reply`)、notify(`PUT/config`/`POST/test`)、health(`POST/cookies`/`POST/verify`)、update(全部 `requireAdmin`)。**无遗漏写路由。** | ✅ 全覆盖 |
| 6 | 容量上限 | `config.js:207/209/215`（`clockRecordsMaxPerUser`/`maxUsers`/`maxBaoliaoItems`）+ `baoliao.js:117` 与 `store.js:356` 截断 + `users.js:116,150` 录入上限 | ✅ 落地 |
| 7 | 自更新事务回滚 | `selfUpdate.js:178-204` `rollback` 还原源码 **+ 重建 node_modules + 清理 web/dist**；`diff` 退出码检查(`:226-229`)、更新后提交号上报(`:220-222`) | ✅ 落地且比描述更完整 |
| 8 | 隐藏 X-Powered-By | `index.js:139` `app.disable('x-powered-by')`（即当前 HEAD 提交），另加 CSP 头(`:158-174`) | ✅ 落地 |
| 9 | HttpOnly token | `auth.js:35-51` `setSessionCookies` `httpOnly:true`；M-13 响应不再回显明文 token(`:93-107,139-141`) | ✅ 落地 |
| 10 | SSRF（H-03 / M-09） | `dnsGuard.js:92-216` `pinnedFetch` = `isSafeSmzdmUrl/isSafePushUrl` 白名单 + `assertPublicDns`（收紧 100.64/0、172.16/12、192.0.0/24、198.18/15、fe80::/10、ff00::/8、fc00::/7 等）+ 自定义 `lookup` **钉死已校验 IP 消除 TOCTOU**；`realAdapter.js:149` 已切换 | ✅ 落地且架构完善；残留限制已文档化（零依赖、未引入 undici） |
| 11 | 其他纵深 | `config.js:13-19` `parseBool` fail-closed；`index.js:349-356` `TRUST_PROXY_AUTH` 致命配置校验；`index.js:361-376` 时区 fail-fast；`index.js:27-34` `unhandledRejection`/`uncaughtException` 兜底 | ✅ 落地 |

### 3.2 新发现风险
- **无新增高危安全回归。**
- 轻微（非安全）：SPA 兜底返回 HTML（见 §2 P2）——不泄露信息，但干扰 API 客户端错误判定。
- 轻微（代码卫生）：`gpt.js` 编码损坏（见 §2 P1）——当前 V8 宽容可运行，但若用 UTF-8 编辑器重新保存会真正乱码甚至破坏语法；建议尽快重存。
- 备注：`assets.js` 仅有 GET 聚合接口，使用 `authRequired` + `computeVisibleUserIds`；开放模式下匿名仅可见同网段聚合，符合设计，非新风险。

---

## 四、测试 / 构建薄弱点
- **测试存在且较充分**：`server/test/` 33 文件 + `web/test/` 11 文件（共 44），覆盖 `auth/security/dnsGuard/selfUpdate/store/rateLimit/routes/securityHeaders` 等安全关键路径——**关键安全修复均有对应测试**，优于一般个人项目。
- **薄弱点**：
  1. **重复代码缺对称测试**：`admin.js` 与 `clock.js` 重复（§2 P1）。需确认 `/api/admin/*` 路径是否被测试覆盖；若仅测 `/api/clock/*`，则 admin 侧相同逻辑可能无独立回归保护（双份漂移风险）。
  2. **HTTP 层并发写集成测试不足**：`withWriteLock` 并发多在 store 层单测覆盖；真实「两并发写请求交错」的端到端集成测试可能缺失（`schedulerTick.test` 存在但 HTTP 并发未覆盖）。
  3. **前端测试偏浅**：`web/test` 仅 11 个，建议补充「会话 Cookie 推导（`auth/config` 的 `loggedIn/isAdmin`）」「路由守卫」「XSS 防护」相关用例。
  4. **部署链路未细评**：`deploy.sh`（17KB）、`Dockerfile` 本次未纳入；建议单独评审其密钥注入（`.env生成`/`PUBLIC_BASE_URL`）、最小权限与 `BIND_ADDRESS=127.0.0.1` 是否默认收紧。
  5. **CI 门禁未验证**：`eslint.config.mjs` 存在，`package.json` 有 `lint`/`test`/`audit:deps` 脚本，但未确认是否在合并前阻断运行。

---

## 五、优先级建议（下一步最该做的 3-5 件事）
1. **【P1 立即】** 以 UTF-8 重存 `gpt.js`（`iconv -f GBK -t UTF-8`），加 `.editorconfig(charset=utf-8)` + 编辑器/CI 编码校验 → 杜绝协作乱码与潜在文件损坏。
2. **【P1 架构】** 消除 `admin.js` 与 `clock.js` 的重复 handler（抽共享工厂），并补齐 `/api/admin/*` 路由等价测试 → 防止双份逻辑漂移。
3. **【P2 健壮性】** 在 SPA 兜底前为 `/api` 增加显式 `404 JSON` 中间件 → 区分 API 与前端路由，改善可观测性。
4. **【P2 解耦】** 打破 `taskRunner↔startup` 循环依赖（抽共享模块或合并）→ 降低中枢模块耦合、便于单测。
5. **【P2 测试/部署】** 补「HTTP 层并发写」集成测试 + 前端会话/Cookie 推导测试；并对 `deploy.sh`/`Dockerfile` 做独立安全评审（密钥注入、最小权限、默认绑定回环）。

---
*注：本评审仅基于 `89231c1` 实际源码，未运行服务、未做动态渗透；安全结论依据代码静态核对与既有测试覆盖。

---

## 整改记录（2026-08-26，基于本报告）

### 已实施（已验证、测试全绿 453/453）
1. **P1 gpt.js 编码修复**：`server/src/routes/gpt.js` 原为 GBK 编码（UTF-8 严格解码失败），已用 `TextDecoder('gbk')` 解码后重存为 UTF-8；`node --check` 通过、严格 UTF-8 解码通过、中文注释不再乱码。
2. **P1 .editorconfig**：仓库根新增 `.editorconfig`（`charset=utf-8`、`end_of_line=lf`、缩进 2 空格），防后续协作乱码。
3. **P2 /api 显式 404**：`server/src/index.js` 在所有 API 路由器之后、SPA 兜底之前新增 `app.use('/api', (req,res)=>res.status(404).json({error:'not_found',message:'未知接口'}))`，未匹配 `/api/*` 返回 JSON 404 而非被 SPA 兜底吞成 200 HTML；`securityHeaders.test.js` 新增回归用例（6/6 通过）。

### 报告中误判、不予整改的项
- **「admin.js 与 clock.js 逐字重复约 120 行」为误判**：主理人已亲自读两文件核实——admin.js 路由为 `/stats`、`/clock-distribution`、`/risk-settings`（独有）；clock.js 路由为 `/status`、`/history`、`/do`（独有且逻辑不同）。二者不存在重复，不做合并重构，避免基于错误前提引入回归。

### 暂缓项（P2，低风险、重构有回归风险，按需另排）
- `taskRunner↔startup` 惰性循环依赖；`store.js:356` 容量静默截断语义；`deploy.sh`/`Dockerfile` 独立安全评审。

### 验证命令
`cd server && node --experimental-test-module-mocks --test "test/**/*.test.js"` → `# pass 453 # fail 0`。
*
