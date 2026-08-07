# 深度审核报告（zdmclock-clone）

> 审核范围：最近两期功能「自动从仓库更新」（d3f890d）与「自检结果可视化」（2180e3a），以及相关的鉴权/调度/装配链路。
> 基线：后端 `node --test` 178/178 通过；前端 `vitest` 25/25 通过；`vite build` 通过。
> 结论：**功能可用，可视化稳健；但"自动更新/自重启"存在 3 个高危项，开启 `AUTO_UPDATE_APPLY=true` 或端口暴露前必须修复。**

---

## 🔴 高风险（P0，上线/开自动更新前必改）

### H1. 自重启无优雅端口交接 + 无回滚 + 静默失败（可致服务宕机）
- **位置**：`server/src/selfUpdate.js` `scheduleRestart()`（L222-236）；`server/src/index.js` 未保存/导出 `server` 实例。
- **问题**：
  1. `scheduleRestart` 用 `spawn` re-exec 新进程后**立即 `process.exit(0)`**。旧进程释放端口与新进程 `app.listen` 之间存在竞态；更关键的是 `index.js` 没有保存 `server` 实例，重启前无法 `server.close()` 主动释放端口。
  2. `stdio: 'ignore'` **吞掉新进程所有输出**。若新版本启动即崩（语法错误、依赖缺失、配置不兼容），旧进程早已退出 → **服务静默下线且无任何日志**。
  3. 无回滚机制：fail-closed 仅覆盖"install/build 失败不重启"，但"启动后崩溃"无防护。
- **影响**：开启 `AUTO_UPDATE_APPLY=true` 或手动点「立即更新」后，一旦新版本启动失败 = 全站下线且难定位。
- **修复建议**：
  - `index.js` 保存并导出 `server` 实例（`const server = app.listen(...)`，`export { app, server }`）。
  - 重启前先 `server.close()`（拒绝新连接、等待已建立连接收尾），再 spawn 新进程。
  - 将新进程 stdout/stderr 重定向到 `logs/restart-<ts>.log`，**不要用 `stdio:'ignore'`**。
  - 生产环境建议把重启职责交给 supervisor（systemd / pm2 / docker 的"退出即拉起"），更新逻辑只做 `pull + build + exit(0)`。

### H2. 更新接口默认免鉴权 + 仅通用 Token，无管理员隔离 ✅ 已修复（2026-08-07）
- **位置**：`server/src/auth.js` `authRequired`（L13-19）；`server/src/routes/update.js`。
- **问题**：
  - `authRequired` 在 `requireAuth=false`（默认开箱即跑）时直接 `next()`，**更新接口完全免鉴权**。
  - 即便开启鉴权，只校验一个通用 `API_TOKEN`，未区分"管理员"。而更新接口会执行 `git pull + npm install + 重启`——端口一旦暴露（公网或不可信内网），等于授予"拉取任意远端代码并以服务身份执行"的能力（供应链/RCE 相邻风险）。
- **修复（已落地）**：
  - 新增 `requireAdmin` 中间件（`server/src/auth.js`），更新接口 `GET /status` / `POST /check` / `POST /apply` 全部改用它。
  - **永远需要鉴权，不受 `REQUIRE_AUTH=false` 影响**：配置了 `ADMIN_TOKEN` 时只认 `ADMIN_TOKEN`；未配置时退回"通用 `API_TOKEN` + 必须 `REQUIRE_AUTH=true`"，仍不允许匿名放行。
  - 新增独立 `ADMIN_TOKEN` 配置项；`/api/auth/login` 登录时一并返回 `adminToken`；前端 `client.js` 存储并在更新调用时附带 `X-Admin-Token` 头。
  - 部署脚本 `deploy-vps.sh` 与 `.env.example` 已自动生成/说明 `ADMIN_TOKEN`。
  - 测试覆盖：`server/test/update.test.js` 新增 4 例（含"REQUIRE_AUTH=false 时更新接口仍 401"这一关键回归用例）。

### H3. 并发无互斥：重复点击 / 调度与手动同时触发会互相破坏
- **位置**：`server/src/routes/update.js` `POST /apply`；`server/src/scheduler.js` `runUpdateCheck`。
- **问题**：`runUpdate` 无进程内锁。用户连点「立即更新」、或调度器自动更新与手动更新在时间窗重叠，会并发执行 `git pull`/`npm install`/`npm run build`：轻则 `npm install` 互相打断导致 `node_modules` 半残，重则两次 `scheduleRestart` 抢占端口 / 双进程。
- **修复建议**：模块级 `let busy=false` 互斥；`runUpdate` 开头 `if (busy) return { ok:false, error:'更新进行中' }`；`/status` 暴露 `busy` 供前端禁用按钮。

---

## 🟠 中风险（P1）

### M1. `POST /apply` 同步阻塞到构建完成，客户端易超时 ✅ 已修复
- **位置**：`server/src/routes/update.js` L40-53；前端 `Update.vue` `apply()`。
- **问题**：`runUpdate` 内含 `npm install`/`npm run build`（各 5 分钟超时），整段 `await` 后才响应。浏览器/网关 2 分钟超时后客户端报错，但服务端实际已完成并重启 → "看到失败实为已更新"，困惑。
- **修复**：改为异步——`POST /apply` 立即返回 `202 {accepted:true}`，更新在后台执行；`runUpdate` 新增 `onLog` 实时推送日志；`GET /status` 暴露 `apply:{status,log,result}`，前端每 1.5s 轮询展示进度与最终结果。并发申请返回 `409 busy` 防护。按钮置灰直到 `busy=false`。后端 2 个用例、前端 2 个用例覆盖。

### M2. 自动更新无备份/快照
- **位置**：`server/src/selfUpdate.js` `runUpdate` / `runUpdateCheck`。
- **问题**：拉取即覆盖工作区，破坏性变更无法一键回退（见 H1）。
- **修复建议**：更新前记录旧 commit（或 `cp` 快照 `web/dist`/`node_modules`），文档给出 `git revert` 步骤。

### M3. 脏工作区判定过严（含未跟踪文件则拒绝） ✅ 已修复
- **位置**：`server/src/selfUpdate.js` `getRepoState`（L82-84）+ `runUpdate`（L146）。
- **问题**：`git status --porcelain` 把未跟踪文件（本地日志、`*.local` 等）也计入 dirty → 误拒更新。`.env` 已被 gitignore 不显示，但其它本地产物会卡住更新。
- **修复**：仅以**被追踪文件**的改动判定脏（`??` 开头的未跟踪行忽略），未跟踪文件单独记到 `untrackedFiles` 供前端提示（不影响 ff-only 更新）。`runUpdate` 的脏校验现只针对 tracked。2 个用例覆盖（含仅未跟踪文件时 `dirty=false`）。

---

## 🟡 低风险 / 建议（P2）

- **L1. 环形图**：已确认 `dasharray="CIRC 0"` 渲染实心环正确；`total=0` 有 `v-if` 守卫；`failedCount` 与 `counts.FAIL` 来源一致（均 = FAIL 数），无错位。仅建议给长 `detail` 补 `:title` 悬浮全文。
- **L2. 手动 `/apply` 未限定生产环境**：开发态点「立即更新」会真实 `git pull`+`build`+重启 dev server。建议路由加 `NODE_ENV==='production'` 或显式开关保护。
- **L3. Windows `/.dockerenv` 探测**：解析为 `<盘>:\.dockerenv`，不存在 → 返回 `native`，无副作用；文档应注明自更新主场景是 Linux 原生/容器。
- **L4. `getRepoState` 的 `gitRoot` 回退**：`rev-parse --show-toplevel` 失败时回退 `process.cwd()`，随后 `--is-inside-work-tree` 自然失败并报"非仓库"，行为正确。

---

## ✅ 已确认稳健

- **无命令注入**：所有外部命令经 `execFile(cmd, args[], opts)`（参数数组，不走 shell）；`branch` 等拼进参数但来源是 `git` 自身输出而非用户输入，无 shell 元字符风险。
- **仅 ff-only**：`git pull --ff-only` 不会自动 merge/rebase，杜绝覆盖本地提交。
- **Docker 通道禁更新**：容器内返回明确指引，避免无效 pull。
- **测试覆盖**：后端 186、前端 26 全绿；self-update 用注入式假 runner，route 用假模块，未触碰真实 git/网络。
- **可视化图表数据契约对齐**：`verifyRealMode` 返回 `{name,kind,status,detail,ms}`，组件字段完全匹配；几何运算正确。
- **常量时间 token 比较**：`safeEqual` 防计时侧信道。

---

## 修复优先级

- **P0（上线/开自动更新前必改）**：H1（优雅重启 + 日志 + supervisor）、H2（更新接口鉴权隔离）、H3（并发锁）。
- **P1**：M1（异步化 + 轮询日志）、M2（快照回滚）、M3（脏判定放宽）。
- **P2**：L2（env 限制）、L1（细节）、L3（文档）。
