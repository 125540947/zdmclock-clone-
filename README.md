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

---

## 部署

### 方式一：Docker（推荐）

```bash
docker compose up -d --build
# 访问 http://<服务器IP>:3000
```

数据持久化于挂载卷 `./server/data`。

### 方式二：云服务器 / PaaS

1. 上传仓库（`web/dist` 已预构建入库，可跳过构建直接运行）
2. 安装依赖：`npm install`
3. 启动：`npm start`（已内置 `NODE_ENV=production`，单进程托管 API + 前端）
   - 如需重新构建前端：`npm run build` 后再 `npm start`
4. 用 nginx / Caddy 反代 `:3000`，或直接暴露该端口

> 多数 PaaS（如 Railway、Render、Fly.io）识别根 `package.json` 的 `build`/`start` 脚本即可自动部署。

---

## 安全须知（部署前必读）

本骨架默认以「开箱即跑、本地自用」为优先级：**默认关闭鉴权、明文存储账号 Cookie**。若暴露到公网，请务必处理以下项：

1. **启用鉴权**：在 `.env` 设 `REQUIRE_AUTH=true`，并把 `ADMIN_PASSWORD` 改为强随机值（默认 `admin123` 切勿带入生产）。`API_TOKEN` 现在**默认留空即每次启动随机生成**，生产请显式设置为固定强随机值（如 `openssl rand -hex 24`），不要依赖随机值。开启后，所有写接口（含 `/api/baoliao` 的 POST/PUT/DELETE/submit）均需 `Authorization: Bearer <API_TOKEN>`。
2. **切勿将敏感文件打进镜像**：仓库已提供 `.dockerignore`，排除 `.env`、`server/data*`。Docker 构建依赖它，不要删除或改回 `COPY . .` 全量拷贝。
3. **真实 Cookie 明文存储**：`server/data*/db.json` 以明文保存 smzdm 登录态（等同于你的账号凭据）。已通过 `.gitignore` 排除，请勿提交、备份或共享这些目录。
4. **CORS 默认仅同源**：已修复为默认 `cors({ origin: false })`，不返回跨域头，**杜绝任意域调用**。仅在「前端部署在独立域名」时才设置 `CORS_ORIGIN` 环境变量放行你的域名。

### 真实适配器端点状态
- ✅ **已验证可用**：`doClockIn`（`robot/token → checkin` 真实签到链路；签名算法已修正 `error_code` 字符串比较 bug）。
- ⚠️ **待你抓包验证（可能失效）**：`getUserInfo`（`/user/`）、`doComment` / `doFavorite` / `doPoint` 的 `BASE` 为 `www.smzdm.com`、路径为社区推测值，大概率需按真实接口修正。启用对应自动任务前请先手动验证，避免触发风控。

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

## 页面状态

- **已完整实现（真实页面）**：
  - 每日签到 `userclock`（目标页）、签到中心 `clock`、连续签到 `userclock2`、积分总览 `userclock3`、账号资料 `userinfo`
  - 录入账号 `addCookies`、我的账号 `users`、签到记录 `history`、自动任务 `tasks`、运行台 `manage`、管理后台 `admin`
  - 自动评论 `comment` / 自动收藏 `favorite` / 自动点赞 `point`（统一 `TaskCenter` 组件）、好价爆料 `baoliao`、GPT 自动回复 `gptReply`
- **长尾变体重定向**：`comment*`、`favorite*`、`point*`、`adminPannel` 等已重定向到就近真实页。
- **占位承接**：`shops` / `updateTSFP` / `test` 等无独立功能对应的路由在「全部模块」页以占位页承接。

---

## 许可证

本仓库为工程骨架示例，仅供学习与研究。接入真实第三方平台时请遵守其服务条款与相关法律法规。
