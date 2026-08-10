# zdmclock 测试补全复盘（2026-08-10）

> 一句话结论：后端用例 **197 → 350 全过（0 失败）**、整体行覆盖 **76.97% → 89.13%**，并挖出 **2 个真实生产回归 bug** + 1 个潜伏 flaky。测试补全工作流 100% 闭环，2 笔提交已本地就绪待推送。

---

## 1. 覆盖率演进总表

| 指标 | 基线 | 终态 | 增量 |
| --- | --- | --- | --- |
| 后端用例数 | 197 | **350** | +153 |
| 后端行覆盖 | 76.97% | **89.13%** | +12.16pt |
| 后端分支覆盖 | 71.95% | 77.75% | +5.80pt |
| 后端函数覆盖 | 76.99% | 84.63% | +7.64pt |
| 前端用例数（vitest） | 26 | 26 | 0（本轮未动） |

### 关键模块行覆盖 before → after

| 模块 | 基线 | 终态 |
| --- | --- | --- |
| `auth.js`（安全函数） | 69.93% | **100%** |
| `middleware/rateLimit.js` | 76.92% | 92.31% |
| `routes/clock.js` | 31% | **90.71%** |
| `routes/tasks.js` | 29% | **81.06%** |
| `routes/baoliao.js` | 57% | 77.60% |
| `routes/health.js` | 40% | **96.55%** |
| `routes/gpt.js` | 54% | **100%** |
| `routes/notify.js` | 39% | **97.37%** |
| `routes/assets.js` | 69% | **100%** |
| `routes/auth.js`（路由） | 50% | **100%** |
| `routes/extremeLazy.js`（路由） | 23.5% | **88.24%** |
| `src/extremeLazy.js`（编排） | 10.68% | **90.60%** |
| `src/smzdm/realAdapter.js` | 67% | **99.52%**（func 96.67%） |
| `index.js`（启动/中间件/SPA） | — | 72.94% |

用例数分阶段：197 → 220 → 261 → 287 → 326 → 344 → **350**。

---

## 2. 分阶段工作流

1. **基线 + 红套件修复（P0 前置）**：审计期代码改动致 3 处旧断言失配（`routes.test.js` 断言已删除的 `upserted` 字段、`?token=` 鉴权；`client.test.js` 缺 axios `request.use`）。对齐后 197/197、26/26 全绿。
2. **P0/P1 安全测试（3 文件，+23 → 220）**：`authSecurity` / `rateLimit` / `securityHeaders`，`auth.js` 拉满 100%。
3. **P0 路由核心（1 文件，+41 → 261）**：`routesCore` 覆盖 clock/tasks/health/baoliao + SSRF 守卫（P0-1）+ openMode 跨段 403（P0-3）。`clock.js`/`tasks.js`/`health.js` 大幅提升。
4. **编排 + 适配器（2 文件，+33 → 287）**：`extremeLazy`（mock.module）+ `realAdapter` 纯函数/`call`/互动/`fetchBaoliao`。`extremeLazy.js` 10%→90.6%。
5. **路由 + 启动收尾（6 文件，+39 → 326）**：gpt/notify/assets/authRoute/extremeLazyRoute/index。**挖出 bug1**（extremeLazy 路由漏 import persist）。
6. **realAdapter 真实网络分支（1 文件，+18 → 344）**：stub 全局 fetch，覆盖 robot/web 双链路。**挖出 bug2**（doClockIn 调未定义 webCheckIn）+ flaky 修复。
7. **防御分支收尾（1 文件，+6 → 350）**：LRU 淘汰 / extras catch / >5MB 守卫。`realAdapter.js` 99.52%。

---

## 3. 挖出的真实生产 bug（高价值）

### Bug 1 — `routes/extremeLazy.js` 漏 import `persist`（响应永久挂起）
- **现象**：`POST /api/extreme-lazy/run` 运行期抛 `ReferenceError: persist is not defined`，HTTP 响应永远挂起 → 极端懒人流水线**经 Web 触发完全不可用**。
- **根因**：文件只 `import { load, withWriteLock }`，路由 handler 却调用了 `persist()`。
- **为什么之前没发现**：编排层 `extremeLazy.test.js` 用 `mock.module` 把 `store` 整个 mock 掉，根本不会执行真实 `persist` 符号解析。只有路由层集成测试（`extremeLazyRoute.test.js`）才走到真实 import 图。
- **修复**：`import { load, withWriteLock, persist } from '../store.js';`

### Bug 2 — `realAdapter.js` `doClockIn` 调未定义 `webCheckIn`（签到双链路 fallback 失效）
- **现象**：APP 签到（`robotCheckIn`）失败时，网页兜底 `webCheckIn` 永远走不到，被 inner catch 吞成 `robotErr` 掩盖，用户看到"签到失败"但实际是兜底链路死了。
- **根因**：`doClockIn`（line 386）写 `webCheckIn(cookie)`，但 `webCheckIn` 仅是 `realAdapter` 对象**方法**（line 395），模块作用域无此符号 → `ReferenceError`。
- **为什么之前没发现**：旧 `realAdapter.test.js` 的 robot 失败分支只断言"抛 robotErr"，恰好与"被吞掉的 ReferenceError 改抛 robotErr"行为一致 → **假过**。补真实网络分支测试后暴露。
- **修复**：`realAdapter.webCheckIn(cookie)`（调用对象方法而非模块作用域函数）。

### Flaky 修复 — `assets.test.js` 账本排序不稳定
`a1`/`a2` 两条用 `new Date().toISOString()` 同毫秒生成 → ts 相同 → 按 ts 倒序排序不稳定（注释自相矛盾地"不依赖顺序"却断言顺序）。改为 `a1` 早 1 小时、`a2` 用 now，排序确定。

---

## 4. 关键踩坑与解法（Node 22 测试基建）

| 踩坑 | 解法 |
| --- | --- |
| `mock.module is not a function` | 加 `--experimental-test-module-mocks` flag |
| Windows 裸 `C:\...` specifier 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME` | 用 `pathToFileURL()` 生成 `file://` URL |
| `factory` 形式对 ESM `named import` 暴露有缺陷（下游报"does not provide an export"） | 改 `namedExports` 且**补全被 mock 模块的全体被消费导出**（store 须含 `todayStr`/`localDateStr`；notifier 须含 `notify`，因 `clock.js` 也 import） |
| extremeLazy 内含真实拟人化 sleep（600~1800ms），8 用例串行 ~100s 撞 timeout | 固化 `--test-timeout=300000` |
| `server.listen(0)` 句柄挂起、文件级撞 timeout | 测试末尾补 `test('关闭测试服务器', () => server.close())` teardown |
| `index` 的 SPA 兜底 `app.get('*')` 接住所有 GET | "未知路径 404"必须用 `POST` 测 |
| `globalThis.fetch` stub 子串误匹配（`'/checkin'` 先命中 `all_reward`） | 调整 routerFetch 路由顺序 |
| `doCheckinExtras` 断言错（`removeTags` 把标签替成空格） | 期望值改为 `'获得 5 金币'` |

**测试脚手架范式**：`createApp()` + 临时 `DATA_DIR`（隔离磁盘态）+ 真实 Express 随机端口；`store.js` 模块级 cache 可在测试进程内 `mutate` 构造数据；全局 `fetch` stub（`routerFetch` 按 URL 子串路由）脱离真实网络测 smzdm 分支。

**测试脚本变更**（已入库）：`server/package.json` 的 `test` 改为
`node --experimental-test-module-mocks --test --test-timeout=300000 "test/**/*.test.js"`。

---

## 5. 新增 / 修改测试文件清单

### 新增（13）
| 文件 | 用例 | 覆盖重点 |
| --- | --- | --- |
| `authSecurity.test.js` | — | `auth.js` 全部安全函数（OPEN_MODE 同段/管理员绕过/写守卫） |
| `rateLimit.test.js` | — | 限流中间件（计数/429/窗口重置） |
| `securityHeaders.test.js` | — | CSP 头集成 |
| `routesCore.test.js` | 41 | clock/tasks/health/baoliao + SSRF + openMode 跨段 |
| `realAdapter.test.js` | 25 | 纯函数/`call`/互动/fetchBaoliao |
| `extremeLazy.test.js` | 8 | 编排全流程（mock.module） |
| `gpt.test.js` | — | gpt 路由各分支 + 502 |
| `notify.test.js` | — | 凭据遮罩 + webhook SSRF 守卫 |
| `assets.test.js` | — | 资产/账本聚合 + 钳制 |
| `authRoute.test.js` | — | 登录/OPEN_MODE 令牌模型 |
| `extremeLazyRoute.test.js` | — | POST /run 返回 taskId |
| `index.test.js` | — | SPA 兜底 /api/health / 404 |
| `realAdapterNet.test.js` | 24 | robot/web 双链路 + 防御分支 |

### 修改（3）
- `routes.test.js`：对齐审计后安全行为（去 `upserted`/`?token=` 旧断言）
- `client.test.js`：补 axios `request.use` mock
- `assets.test.js`：账本 ts 确定性修复 flaky

---

## 6. 残留与后续

- **合理 P2 残余（2 行）**：`realAdapter.js` line 33 `dbgLog` 的 `console.log`（仅 `SMZDM_DEBUG=1` 触发，ESM 模块级常量无法在测试内翻转）；317-318 robot 额外奖励外层 catch（内层 catch 已保护，实际不可达）。
- **前端测试**：26/26 维持，本轮未新增。
- **长期 backlog**：smzdm 自动**点赞/收藏自动化失败**（项目已知待修复项，独立于本工作流）。

---

## 7. 交付状态

- 提交 `792d5b4`（18 文件，+1905/−126）：全套测试补全 + 2 个真实 bug fix + flaky fix + `package.json` 测试脚本加固。
- 提交 `357d449`（1 文件，+78）：realAdapter 防御分支补全。
- **本地领先 `origin/main` 2 笔，待推送**（本环境无 GitHub 凭据，`git push` 被阻塞）。
- 工作区仅 `.claude-flow/*` 与 `probe_WW*.txt` 为外部进程产物，**未纳入提交**。
- 用户自有终端推送命令：`cd zdmclock-clone && git push origin main`
