# 值得买（smzdm）签到助手 · 前端+后端完整骨架

基于对一个线上 uni-app H5 站点（`zdmclock.bitup.top`）的**前端逆向分析**重建的工程骨架。
目标：克隆后**无需额外修改即可一键部署运行**，还原原站打卡页（`#/pages/smzdm/userclock`）及配套功能的数据流与界面。

> ⚠️ **务必先读：边界说明**
> 1. **后端源码无法克隆**。原站后端对我不可见，本仓库的后端是依据前端调用**重新实现的一套等价骨架**，并非原站源码。
> 2. **smzdm 真实调用已隔离为「适配器」**。`SMZDM_ADAPTER=mock` 时返回仿真数据，流程 100% 跑通；设为 `real` 后需你自行在 `server/src/smzdm/realAdapter.js` 中实现（详见下文）。
> 3. **自动化访问 smzdm 可能违反其《用户协议》**。请仅在自有账号、且了解风险的前提下接入 real 适配器，切勿用于批量/商用。

---

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | Vue 3 + Vue Router + Vite | Hash 路由，移动端 H5，深色暖调「签到奖励」主题 |
| 后端 | Node.js + Express (ESM) | REST API，JSON 文件持久化，生产环境托管前端 |
| 数据 | 本地 JSON 文件 (`server/data/db.json`) | 零外部依赖，开箱即跑 |
| 部署 | npm workspaces / Docker | 单进程同时提供 API 与静态资源 |

---

## 目录结构

```
zdmclock-clone/
├── package.json            # 根：npm workspaces，统一 dev/build/start
├── .env.example            # 环境变量模板（复制到仓库根 .env）
├── Dockerfile
├── docker-compose.yml
├── server/                 # 后端
│   ├── package.json
│   └── src/
│       ├── index.js        # Express 入口（API + 生产托管前端）
│       ├── config.js       # 读取 .env
│       ├── store.js        # JSON 文件持久化
│       ├── auth.js         # 鉴权中间件 + cookie 遮罩
│       ├── routes/         # auth / users / clock / tasks / admin
│       ├── taskRunner.js   # 手动触发与定时调度共用的任务执行逻辑
│       ├── scheduler.js    # 轻量 cron 调度器（零依赖，随服务启动）
│       └── smzdm/          # 适配器：mock（默认仿真） / real（真实 HTTP 骨架）
└── web/                    # 前端
    ├── package.json
    ├── vite.config.js      # 开发代理 /api → :3000
    ├── index.html
    ├── .env                # VITE_API_BASE=/api
    └── src/
        ├── main.js / App.vue / router/
        ├── api/client.js   # axios 封装
        ├── styles/global.css# 设计系统
        └── views/          # UserClock / ClockCenter / StreakView / PointsView /
                            #   UserInfo / TaskCenter / Baoliao / GptReply / … / Placeholder
```

---

## 快速开始（本地）

要求：Node.js ≥ 18。

```bash
# 1. 安装全部依赖（根目录，自动安装 server 与 web 两个 workspace）
npm install

# 2. 开发模式（前端 :5173 + 后端 :3000，热更新）
npm run dev

# 3. 或：生产构建并启动（单进程 :3000，托管前端）
npm run build
npm start
```

打开 http://localhost:5173 （开发）或 http://localhost:3000 （生产）。

> 首次运行会自动在 `server/data/db.json` 生成默认任务（签到/评论/收藏/点赞）。

---

## 环境变量

复制 `.env.example` 为根目录 `.env` 后按需修改（所有项均有默认值，不配置也能跑）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端监听端口 |
| `NODE_ENV` | `development` | `production` 时后端托管前端 `dist` |
| `REQUIRE_AUTH` | `false` | `true` 时写操作需 Bearer Token |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | 管理登录凭据 |
| `API_TOKEN` | 留空=启动随机生成 | 登录签发给前端的 Token。生产请显式设置强随机值（默认已不再使用静态 `zdmclock-dev-token`） |
| `CORS_ORIGIN` | 留空=仅同源 | 跨域白名单，逗号分隔。默认不返回 CORS 头，杜绝任意域调用 |
| `SMZDM_ADAPTER` | `mock` | `mock`（仿真）｜ `real`（需自行实现） |
| `SMZDM_REQUEST_TIMEOUT` | `10000` | real 适配器对外请求超时（毫秒），防止 smzdm 无响应时永久挂起 |
| `DATA_DIR` | `./data` | JSON 数据库相对路径 |
| `WEB_DIST` | `../web/dist` | 前端产物目录 |

前端 `web/.env` 中 `VITE_API_BASE=/api` 为相对路径，开发经 Vite 代理、生产由同源后端接管，无需改。

---

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/health/cookies` | 手动触发全部账号 Cookie 健康检测（检测 + 标记失效 + 推送告警） |
| POST | `/api/auth/login` | 管理员登录，签发 Token |
| GET | `/api/users` | 账号列表（cookie 遮罩） |
| POST | `/api/users` | 录入 smzdm 账号（cookie） |
| GET/PUT/DELETE | `/api/users/:id` | 账号详情 / 更新 / 删除 |
| POST | `/api/users/:id/refresh` | 刷新账号资料 |
| GET | `/api/users/:id/smzdm` | 拉取该账号 smzdm 真实资料（调用适配器） |
| GET | `/api/clock/status` | 签到状态 + 30 天日历 |
| POST | `/api/clock/do` | 执行签到 |
| GET | `/api/clock/history` | 签到记录（倒序分页） |
| GET | `/api/tasks` | 任务列表 |
| PUT | `/api/tasks/:id` | 启用/停用/改名/cron |
| POST | `/api/tasks/:id/run` | 手动执行任务 |
| GET | `/api/admin/stats` | 管理后台概览 |
| GET | `/api/baoliao` | 好价爆料列表（?userId= 可过滤） |
| POST | `/api/baoliao` | 新增爆料草稿 `{title,url,price,cat,content}` |
| PUT | `/api/baoliao/:id` | 更新爆料 |
| DELETE | `/api/baoliao/:id` | 删除爆料 |
| POST | `/api/baoliao/:id/submit` | 提交到 smzdm（经适配器；需账号 Cookie） |

---

## 定时调度器（自动执行任务）

后端内置一个**零依赖的轻量 cron 调度器**，随服务启动自动开启（见 `/api/health` 的 `scheduler` 字段）：

- 每 30 秒轮询一次任务表；命中 cron 且**已启用**的任务会自动执行（调用对应 smzdm 适配器）。
- 执行结果回写任务的 `lastRun` / `lastResult` / `status`，前端「自动任务」页实时可见。
- cron 支持标准 5 段写法：`分 时 日 月 周`，支持 `*`、`*/n`、`a-b`、`a,b`（如 `0 9 * * *` 每天 9:00，`*/30 * * * *` 每 30 分钟）。
- 手动执行（`POST /api/tasks/:id/run`）与定时调度共用 `server/src/taskRunner.js` 的同一套执行逻辑。

> 适合个人单机部署。若需多实例高可用，请改用系统 cron / k8s CronJob 等外部调度，并将本调度器关闭。

### Cookie 健康检测（防静默失效）

Cookie 失效后任务只会静默标 `error`，难以察觉。本工具内置 **Cookie 健康检测**：

- **定时**：调度器每轮轮询时，按 `COOKIE_HEALTH_INTERVAL_MIN`（默认 360 分钟）节流，仅 **real 模式**下对所有账号做一次探活（`server/src/health.js`）。
- **手动**：`「我的账号」页` 点 **🍪 检测** 按钮（`GET /api/health/cookies`），或任意时刻调用该接口。
- **判定**：调用适配器 `getUserInfo`——返回有效身份即有效；抛错（网络/超时/被踢线重定向）或返回空身份即视为失效。
- **告警**：失效时通过已配置的推送渠道（`notifier`）发「🍪 Cookie 失效告警」，且**仅在「有效→失效」状态迁移时触发一次**（自愈恢复后清零，不重复刷屏）。
- 前端「我的账号」列表对失效账号显示 **🍪 Cookie 失效** 红色徽标。

> 注：检测为 best-effort，单次瞬时网络抖动可能误报，故内置 1 次重试（800ms）吸收抖动；即便误标，下一轮成功会自动自愈。

### 真机端点一键验证（部署前自检）

real 模式的端点/签名均来自社区逆向（best-effort），smzdm 改版可能失效。**部署 `SMZDM_ADAPTER=real` 前，先用自己的 Cookie 跑一次诊断**，逐项报告哪些内置端点仍有效：

```bash
cd server
SMZDM_COOKIE="你的Cookie" node tools/verifyRealMode.mjs
# 或带参： node tools/verifyRealMode.mjs "<Cookie>" --with-checkin
```

- 默认**只读探测**：校验 Cookie 有效性、签名算法、以及 `user-api`、`task/list_v2`、`转盘 active_id 自动发现`、`众测 activity_id 自动发现`、评论/收藏/点赞/爆料遗留端点的可达性与解析结构——**不调用任何会消耗抽奖次数/领取奖励的写接口**（jsonp_draw / activity_task_receive / ajax_participate / 实签）。
- 加 `--with-checkin` 才真正签一次到（每日一次，低风险），用于端到端验证签到链路。
- 任一项 `✗ FAIL`：多为 smzdm 端点/结构变更或 Cookie 失效，用同名环境变量（`SMZDM_SIGN_KEY` / `SMZDM_API_BASE` / …）覆盖或重新抓包更新。

**Web 端一键自检**：登录后进入「我的账号」，每个账号卡片有 **🔍 自检** 按钮，点击即用该账号 Cookie 在服务端跑同一套 `runVerification` 探测，结果以 ✓/✗/⚠ 表格直接展示，无需敲命令行（核心逻辑见 `server/src/verifyRealMode.js`，CLI 与接口共用）。

---

## 部署

> 部署与上线全流程（三种方式 + 真实模式启用 + 公网安全加固 + 资产仪表盘图文）已整合到 **[DEPLOY.md](./DEPLOY.md)**，建议上线前通读。

### 方式一：一键部署脚本 `deploy.sh`（推荐，交互式）

`deploy.sh` 是一个**交互式一键部署脚本**，会先自动检测你的环境，再让你选部署方式，并自动补齐缺失的依赖：

- **自动检测**：操作系统类型/版本、CPU 架构（x86_64 / arm64）、是否已装 Docker / Node.js / npm / git / curl / wget，并打印检测报告。
- **交互选择**（运行后输入数字即可）：
  ```
  1) Docker 部署（推荐）—— 环境隔离，自动处理全部依赖
  2) 原生 Node.js 部署 —— 无需 Docker，直接在本机跑（需 Node>=20）
  3) 仅生成环境检测报告，不部署
  ```
- **自动补齐**：所选方式缺依赖时，脚本会给出安装命令（Linux 上 Docker 走官方脚本、Node 走包管理器/NodeSource；Mac 走 brew），安装前会征求你同意。
- 没有 `.env` 时自动从 `.env.example` 生成；启动后自动探测 `/api/health` 确认可用。

**运行（Mac / Linux）**：
```bash
chmod +x deploy.sh
./deploy.sh
# 按菜单选 1（Docker）/ 2（原生 Node）/ 3（仅诊断）
# 访问 http://<服务器IP>:3000
```

**运行（Windows）**：需用 **Git Bash**（右键代码文件夹 → Git Bash Here）执行 `./deploy.sh`；PowerShell 不能直接跑 `.sh`。若 Git Bash 也不方便，可用下方「方式二」的手动命令。

### 方式二：Docker Compose 手动（无需脚本）

```bash
cp .env.example .env   # 按需修改：真实 cookie / SMZDM_ADAPTER=real / 强 API_TOKEN 等
docker compose up -d --build
# 访问 http://<服务器IP>:3000
```

要点：
- 配置统一从宿主机 **`.env`** 读取（compose 的 `env_file`），真实签到所需的 cookie、`SMZDM_ADAPTER` 等写在 `.env` 即生效，无需改 compose。
- 数据持久化于**命名卷 `zdmclock-data`**（与宿主机代码隔离，容器重建不丢、不与本地开发数据混淆）。
- 镜像已强制 `NODE_ENV=production`，后端自动托管 `web/dist` 前端。

### 方式三：原生 Node.js / 云服务器 / PaaS

1. 上传仓库（`web/dist` 已预构建入库，可跳过构建直接运行）
2. 安装依赖：`npm install`
3. 启动（`NODE_ENV=production` 由 `npm start` 自动写入，单进程托管 API + 前端）：
   ```bash
   npm start
   ```
   - 如需重新构建前端：`npm run build` 后再 `npm start`
4. 用 nginx / Caddy 反代 `:3000`，或直接暴露该端口

> 多数 PaaS（如 Railway、Render、Fly.io）识别根 `package.json` 的 `build`/`start` 脚本即可自动部署。
> 也可直接运行 `./deploy.sh` 选 **2) 原生 Node.js 部署**，由脚本自动检测并补齐 Node 环境，无需手动安装。

---

## 安全须知（部署前必读）

本骨架默认以「开箱即跑、本地自用」为优先级：**默认关闭鉴权、明文存储账号 Cookie**。若暴露到公网，请务必处理以下项：

1. **启用鉴权**：在 `.env` 设 `REQUIRE_AUTH=true`，并把 `ADMIN_PASSWORD` 改为强随机值（默认 `admin123` 切勿带入生产）。`API_TOKEN` 现在**默认留空即每次启动随机生成**，生产请显式设置为固定强随机值（如 `openssl rand -hex 24`），不要依赖随机值。开启后，所有写接口（含 `/api/baoliao` 的 POST/PUT/DELETE/submit）均需 `Authorization: Bearer <API_TOKEN>`。
2. **切勿将敏感文件打进镜像**：仓库已提供 `.dockerignore`，排除 `.env`、`server/data*`。Docker 构建依赖它，不要删除或改回 `COPY . .` 全量拷贝。
3. **真实 Cookie 明文存储**：`server/data*/db.json` 以明文保存 smzdm 登录态（等同于你的账号凭据）。已通过 `.gitignore` 排除，请勿提交、备份或共享这些目录。
4. **CORS 默认仅同源**：已修复为默认 `cors({ origin: false })`，不返回跨域头，**杜绝任意域调用**。仅在「前端部署在独立域名」时才设置 `CORS_ORIGIN` 环境变量放行你的域名。

### Ubuntu 公网部署安全加固清单

在云服务器（如腾讯云 / 阿里云 / AWS 的 Ubuntu）上把服务暴露到公网时，**仅改 `.env` 还不够**，还需在系统层面收口：

1. **开防火墙，只留必要的"门"**：用 `ufw` 只放行 `22`（SSH 远程管理）和 `3000`（或下方反代的 `443` / `80`），其余全部拒绝。
   ```bash
   sudo ufw allow 22/tcp
   sudo ufw allow 3000/tcp      # 若走反代则放行 443/80，不必开 3000
   sudo ufw enable
   sudo ufw status
   ```
2. **避免长期以 root 跑、给 docker 权限**：新建专用用户并加入 `docker` 组，避免反复 `sudo` 也避免 root 暴露。
   ```bash
   sudo usermod -aG docker $USER   # 把当前用户加入 docker 组（免 sudo 跑 docker）
   newgrp docker                  # 当前终端立即生效，免注销
   ```
   > 注意：`docker` 组权限约等于 root，仅把**可信用户**加入；不要对不信任账号开放。
3. **用反向代理 + 免费 HTTPS 隐藏裸端口**：对外只暴露 `443`，用 nginx/Caddy 反代到 `:3000`，并自动签发 Let's Encrypt 免费证书，避免管理后台以明文 HTTP 暴露被嗅探。
   ```bash
   # 例：Caddy（最简，自动申请并续期证书）
   # Caddyfile:
   # your.domain.com {
   #   reverse_proxy localhost:3000
   # }
   sudo apt install -y caddy && sudo systemctl enable --now caddy
   ```
   此后浏览器用 `https://your.domain.com` 访问，`.env` 的 `CORS_ORIGIN` 设为该域名。
4. **定期更新系统**以修复内核 / 库漏洞：
   ```bash
   sudo apt update && sudo apt -y upgrade
   ```
5. **复核 `.env` 安全项**（见上方 1）：`REQUIRE_AUTH=true`、强 `ADMIN_PASSWORD`、固定强 `API_TOKEN`、按需设 `CORS_ORIGIN`。

### 内置真实任务清单（移植自青龙社区逆向）

`SMZDM_ADAPTER=real` 后，下列任务的端点、签名、多步流程已内置，无需抓包（端点/签名均为社区逆向 best-effort 值，smzdm 改版可能失效，请用 `verifyRealMode.mjs` 复核）：

| 任务 | 内置端点 | 是否需参数 | 自动发现情况 |
|---|---|---|---|
| 签到 | `robot/token → checkin` | 否 | — |
| 每日任务 | `task/list_v2 → activity_task_receive` | 否 | — |
| 转盘抽奖 | `jsonp_draw`（web 接口） | 否（可填 `activeId`/`topicUrl` 覆盖） | 运行时从内置稳定专题页抽 `hashId` 作 `active_id` |
| 每日抽奖 | 同上（复用 `doTurntable`） | 否 | 同上 |
| 全民众测 | `ajax_get_activity_id → activity_info → task_receive` | 否（可填 `crowd_id` 申请具体商品） | 自动发现全民众测活动，无需 `crowd_id` |
| 自动关注 | `dingyue-api.smzdm.com`（app 签名） | **是**：`target`+`type` | 关注谁需你指定（无法自动发现） |
| 自动分享 | `user-api` 分享三连（app 签名） | **是**：`articleId` | 分享哪篇需你指定 |

- **自动发现类**（签到 / 每日任务 / 转盘 / 抽奖 / 全民众测）：启用 + 设 cron 即跑，参数留空。
- **参数类**（关注 / 分享）：在「参数(JSON)」填目标，如 `{"target":"某用户名","type":"user"}`、`{"articleId":"12345678"}`。

> ⚠️ **原站遗留任务（评论 / 收藏 / 点赞 / 爆料）**：其 real 端点（`realAdapter` 的 `doComment`/`doFavorite`/`doPoint`/`submitBaoliao`）已实现，走 `BASE=www.smzdm.com` + Cookie 鉴权（无 app 签名），路径与社区逆向一致。它们同属 best-effort（smzdm 改版可能失效），现已纳入 `verifyRealMode.mjs` 的**安全可达性探测**（空参数 POST 验端点存活，不真正发表）。启用前请先跑自检确认端点仍通；与「内置真实任务」相比，这部分签名防护较弱（无 app 签名），更易触发风控，建议优先用上表任务。

---

## 接入真实 smzdm 逻辑（real 适配器）

`server/src/smzdm/realAdapter.js` 已是一个**可工作的真实 HTTP 骨架**（基于 Node 内置 `fetch`，零额外依赖）：

- 内置浏览器级请求头与 Cookie 鉴权、JSON 响应解析（兼容 smzdm 常见的 `)]}'` 前缀）、统一的成功/失败判定。
- 接口地址集中在文件顶部的 `ENDPOINTS`，可用同名环境变量覆盖（见 `.env.example` 的 `SMZDM_API_*`），**无需改代码**。

接入步骤：

1. 复制 `.env.example` 为 `.env`，将 `SMZDM_ADAPTER` 改为 `real`
2. 用浏览器/Charles/Fiddler 抓包，得到你账号真实的请求地址与参数，填入 `ENDPOINTS` 或设置 `SMZDM_API_*` 环境变量
3. 在对应方法里按真实响应结构微调字段解析（如 `data.add_point`、`continue_sign_days`）
4. 重启后端。前端无需改动。

> 真实接口字段、参数、反爬会变动，**本骨架不保证长期有效**，需你自行维护。
> 适配器在接口异常时**会真实发起请求并优雅报错**（返回 502 + 错误原因），便于排查，而非静默失败。

---

## 真实模式启用指南（内置任务开箱即跑 · 图文）

`SMZDM_ADAPTER=real` 后，上面「内置真实任务清单」里的任务可直接启用——**无需抓包、无需填参数**（仅 `关注`/`分享` 需填目标）。下面是从零到跑通的分步流程。

### 整体流程

```
① 开真实模式       ② 录入 Cookie      ③ 部署前自检        ④ 启用内置任务      ⑤ 调度+风控       ⑥ Cookie 守护
.env: real   →   粘贴登录态 Cookie  →  verifyRealMode  →  自动发现类免参跑  →  cron 触发   →  每6h探活+失效告警
                                          (只读探测)       关注/分享填目标
```

### 第 1 步：开启真实模式

编辑仓库根 `.env`（从 `.env.example` 复制而来），将：

```ini
SMZDM_ADAPTER=mock     # 改为 ↓
SMZDM_ADAPTER=real
```

重启服务（`npm start` 或容器重建）。超时 `SMZDM_REQUEST_TIMEOUT`（默认 10000ms）一般无需改。

### 第 2 步：录入你的 smzdm Cookie

1. 浏览器登录 smzdm → 打开开发者工具（F12）→ **网络/Application** 任一请求头里复制完整的 `Cookie` 值。
2. 前端「**录入账号**」页（`/addCookies`）粘贴保存；或 `POST /api/users`。
3. 多账号可录多个——调度器会**错峰**执行（见第 5 步风控），降低触发限流概率。

> ⚠️ Cookie 等同于你的登录态凭据，本地明文存于 `server/data*/db.json`（已被 `.gitignore` 排除），切勿提交或分享。

### 第 3 步：部署前自检（强烈建议）

real 端点/签名是社区逆向值，smzdm 改版可能失效。**上线前先用自己的 Cookie 跑一次只读诊断**，逐项报 ✅/❌：

```bash
cd server
SMZDM_COOKIE="你的Cookie" node tools/verifyRealMode.mjs
# 加 --with-checkin 才真正签一次到（端到端验证签到链路，每日一次低风险）
```

探测项：签名算法、Cookie 有效性、`user-api` 可达、`task/list_v2` 结构、转盘 `active_id` 自动发现、众测 `activity_id` 自动发现。**不调用任何消耗抽奖/领奖的写接口**。任一 ❌ 先修再上线。

### 第 4 步：启用内置任务（开箱即跑）

到「**自动任务**」页（`/tasks`），把下表任务**启用**并设 **cron**：

| 任务 | 是否需要参数 | 参数示例 | 说明 |
|---|---|---|---|
| 签到 | 否 | — | 真实签到，响应含权威余额（金/碎银/经验） |
| 每日任务 | 否 | — | 自动领每日任务奖励 |
| 转盘抽奖 | 否（可覆盖） | `{"activeId":"xxx"}` 或 `{"topicUrl":"https://m.smzdm.com/topic/..."}` | 内置双转盘专题页，运行时自动抽 `active_id` |
| 每日抽奖 | 否 | 同上 | 复用转盘逻辑 |
| 全民众测 | 否（可覆盖） | `{"crowdId":"xxx"}` | 默认自动发现活动并领能量值，填 `crowd_id` 则申请具体商品 |
| 自动关注 | **是** | `{"target":"某用户名","type":"user"}`（`user`/`tag`/`brand`） | 关注谁需你指定 |
| 自动分享 | **是** | `{"articleId":"12345678"}` | 分享哪篇需你指定（文章数字 ID） |

- **自动发现类**（签到/每日任务/转盘/抽奖/全民众测）：点启用 + 设 cron 即可，**参数留空**。
- **参数类**（关注/分享）：在「参数(JSON)」文本框填上表示例；填了才标记「已就绪」。

### 第 5 步：调度与风控

- **cron 写法**：`0 9 * * *`（每天 9:00）、`*/30 * * * *`（每 30 分钟）。调度器每 30s 轮询，命中即执行。
- **错峰风控**（避免同秒扎堆触发 smzdm 限流）：多账号默认错峰，可调 `.env`：
  ```ini
  CLOCK_STAGGER_MS=800          # 每个账号额外固定等待
  CLOCK_STAGGER_JITTER_MS=2000  # 叠加随机抖动
  CATCHUP_GRACE_MIN=180         # 错过签到后多久内仍补签
  ```
- **遗留 web 端点（评论/收藏/点赞/爆料）拟人化**：这些 `www.smzdm.com` 端点无 app 签名（签名对它无意义），
  已做两层加固以降低被按固定指纹识别为机器的概率——① **UA 轮换**（8 个真实浏览器 UA 池随机取用）；
  ② **动作拟人化间隔**（`count` 多次动作之间随机等待 `SMZDM_ACTION_JITTER_MIN`~`SMZDM_ACTION_JITTER_MAX`，默认 800~2500ms）。
  好价抓取 `fetchBaoliao` 同样轮换 UA。

### 第 6 步：Cookie 失效守护

- 调度器每 `COOKIE_HEALTH_INTERVAL_MIN`（默认 **360 分钟**）自动探活一次（仅 real 模式）。
- 也随时可在「**我的账号**」页点 **🍪 检测** 手动复核；失效账号显示红色「🍪 Cookie 失效」徽标。
- 失效时经「**推送通知**」渠道（Server酱/Bark/Telegram/Webhook，先在「推送通知」页配置）告警，**仅在「有效→失效」迁移时告警一次**（自愈后清零，不刷屏）。

### 风险提示

- 所有 real 端点/签名来自社区逆向（best-effort），smzdm 改版可能失效——请用 `verifyRealMode.mjs` 定期复核。
- 评论 / 收藏 / 点赞 / 爆料为**原站遗留任务**，其 real 端点已实现（`www.smzdm.com` + Cookie，无 app 签名），`verifyRealMode.mjs` 已对其做安全可达性探测；已加 **UA 轮换 + 拟人化间隔** 加固，但仍建议优先用上表“内置真实任务”（带 app 签名）。

---

## 页面状态

- **已完整实现（真实页面）**：
  - 每日签到 `userclock`（目标页）、签到中心 `clock`、连续签到 `userclock2`、积分总览 `userclock3`、账号资料 `userinfo`
  - 录入账号 `addCookies`、我的账号 `users`、签到记录 `history`、自动任务 `tasks`、运行台 `manage`、管理后台 `admin`
  - 自动评论 `comment` / 自动收藏 `favorite` / 自动点赞 `point`（统一 `TaskCenter` 组件）、好价爆料 `baoliao`、GPT 自动回复 `gptReply`
  - **资产仪表盘** `assets`（A/B 协同核心：当前资产 / 日收益曲线 / 任务贡献 / 资产账本，SVG 渲染）
- **长尾变体重定向**：`comment*`、`favorite*`、`point*`、`adminPannel` 等已重定向到就近真实页。
- **已清理的占位页**：原站残留的 `shops` / `updateTSFP` / `test` 三个空壳页已从「全部模块」入口移除（不再渲染）；`/p/:name` 路由与 `Placeholder.vue` 仅作为无害兜底保留。

---

## 许可证

本仓库为工程骨架示例，仅供学习与研究。接入真实第三方平台时请遵守其服务条款与相关法律法规。
