# 部署与上线手册（DEPLOY）

本文把 README 中分散的 **部署方式、真实模式启用、公网安全加固、资产仪表盘** 整合成一份「上线清单」，方便一次性照着做。详细背景仍见 [README.md](./README.md)。

---

## 1. 三种部署方式（速览）

| 方式 | 适用 | 关键命令 |
|---|---|---|
| 一键脚本 `deploy.sh` | 交互式、自动检测环境（推荐） | `./deploy.sh` → 选 1(Docker)/2(原生 Node)/3(仅诊断) |
| Docker Compose | 环境隔离、零依赖 | `cp .env.example .env` → `docker compose up -d --build` |
| 原生 Node / PaaS | 云服务器、Railway/Render 等 | `npm install` → `npm start` |

- 配置统一从宿主机 **`.env`** 读取，真实 Cookie、`SMZDM_ADAPTER` 等写在 `.env` 即生效，无需改代码或 compose。
- 数据持久化于命名卷 `zdmclock-data`（Docker）或 `server/data*/`（原生），已通过 `.dockerignore` / `.gitignore` 排除，勿提交。
- 镜像强制 `NODE_ENV=production`，后端自动托管 `web/dist`。

> Windows 跑 `deploy.sh` 需用 **Git Bash**（PowerShell 不支持 `.sh`）。

---

## 2. 上线前检查清单

- [ ] `.env` 已复制自 `.env.example`，且 `SMZDM_ADAPTER` 按需要设为 `real`（仅自用真实签到时）。
- [ ] 公网暴露前：设 `REQUIRE_AUTH=true`、改强 `ADMIN_PASSWORD`、设固定强 `API_TOKEN`（`openssl rand -hex 24`）。
- [ ] 前端已构建（`npm run build` 生成 `web/dist`；仓库已预构建入库，可跳过）。
- [ ] 启动后探针：`GET /api/health` 返回 `ok:true`、`scheduler:true`。
- [ ] 真实模式：先用 `tools/verifyRealMode.mjs` 跑一次只读自检（见第 3 步）。

---

## 3. 启用真实模式（内置任务开箱即跑）

`SMZDM_ADAPTER=real` 后，下列内置任务**无需抓包、无需填参数**（仅 `关注`/`分享` 需填目标）：

| 步骤 | 动作 | 要点 |
|---|---|---|
| ① 开真实模式 | `.env`: `SMZDM_ADAPTER=real` | 重启生效 |
| ② 录入 Cookie | 「录入账号」页粘贴登录态 | 多账号可录多个，调度器错峰 |
| ③ 部署前自检 | `cd server && SMZDM_COOKIE="..." node tools/verifyRealMode.mjs` | 只读探测，逐项 ✅/❌；不消耗抽奖/领奖 |
| ④ 启用内置任务 | 「自动任务」页启用 + 设 cron | 自动发现类免参；关注/分享填目标 |
| ⑤ 调度 + 风控 | cron 触发；`.env` 调 `CLOCK_STAGGER_MS` 等 | 多账号错峰降低风控概率 |
| ⑥ Cookie 守护 | 每 `COOKIE_HEALTH_INTERVAL_MIN`(默认360min) 自动探活 | 「我的账号」🍪 检测可手动复核，失效经推送告警 |

**内置任务参数表**

| 任务 | 是否需参数 | 参数示例 | 说明 |
|---|---|---|---|
| 签到 / 每日任务 | 否 | — | 真实签到，响应含权威余额 |
| 转盘抽奖 / 每日抽奖 | 否（可覆盖） | `{"activeId":"x"}` / `{"topicUrl":"..."}` | 内置专题页自动抽 `active_id` |
| 全民众测 | 否（可覆盖） | `{"crowdId":"x"}` | 默认自动发现活动领能量值 |
| 自动关注 | **是** | `{"target":"用户名","type":"user"}` | user/tag/brand |
| 自动分享 | **是** | `{"articleId":"12345678"}` | 文章数字 ID |

> 端点/签名均为社区逆向 best-effort 值，smzdm 改版可能失效——定期用 `verifyRealMode.mjs` 复核。评论/收藏/点赞为原站遗留任务，real 端点仍是推测值，启用前需自行抓包验证。

---

## 4. 公网安全加固（Ubuntu 示例）

1. **防火墙只留必要端口**：`sudo ufw allow 22/tcp`、`sudo ufw allow 443/tcp`（走反代则不必开 3000）、`sudo ufw enable`。
2. **避免 root 跑 docker**：`sudo usermod -aG docker $USER` 后 `newgrp docker`。
3. **反代 + 免费 HTTPS**：用 Caddy/nginx 反代 `:3000` 并自动签发 Let's Encrypt，对外只暴露 443，避免后台明文 HTTP 被嗅探；`.env` 的 `CORS_ORIGIN` 设为你的域名。
4. **定期更新**：`sudo apt update && sudo apt -y upgrade`。
5. **复核 `.env` 安全项**：`REQUIRE_AUTH=true`、强密码、固定 `API_TOKEN`、按需设 `CORS_ORIGIN`。

---

## 5. 资产仪表盘怎么看（A/B 协同核心）

入口：**全部模块 → 资产仪表盘**（`/assets`）。它是「任务矩阵（A）」与「资产/收益（B）」协同的落地点——每次真实任务成功后都会写入**资产账本**，仪表盘据此聚合展示。

四个视图：

| 视图 | 内容 | 数据来源 |
|---|---|---|
| 当前资产 | 金币 / 碎银 / 经验 / 等级卡片 | 签到响应权威余额（`cgold`/`pre_re_silver`/`cexperience`/`rank`）+ `user.assets` |
| 日收益曲线 | 按天聚合的资产变化折线（SVG） | `assetLedger` 每日快照 `dailyAssetSeries` |
| 任务贡献 | 各任务带来的金币/碎银/经验占比（条形） | `assetByTask`（按任务类型汇总 ledger 变动） |
| 资产账本 | 每次任务的明细记录（时间/任务/变动/余额） | `recentLedger` |

**联动机制**：`taskMatrix.runCustomEndpointTask` 成功后调用 `applyAssetEffect` 写 `db.assetLedger`、更新 `user.assets` 并落每日快照；仪表盘聚合读取，无需手动记账。

> 提示：曲线/贡献需在 **真实模式（`SMZDM_ADAPTER=real`）跑几天**后才有意义；`mock` 模式下为仿真数据，仅用于验证界面与联动逻辑。

---

## 6. 运维与故障排查

- **Cookie 失效**：调度器每 ~6h 自动探活；「我的账号」点 **🍪 检测** 手动复核；失效账号显示红色徽标并经推送渠道告警（先在「推送通知」页配置 Server酱/Bark/Telegram/Webhook）。
- **端点疑似失效**：跑 `tools/verifyRealMode.mjs`，逐项 ✅/❌ 定位是哪一段（签名 / Cookie / user-api / 转盘 active_id / 众测 activity_id）。
- **任务静默 error**：先看 `/api/health` 的 `scheduler` 是否在跑；再看 `server/data*/db.json` 里任务的 `lastResult` 字段，或后端日志（`SMZDM_REQUEST_TIMEOUT` 默认 10s，smzdm 无响应会优雅报错返回 502）。

---

---

## 7. 系统更新（自动从仓库更新）

部署后想跟上仓库最新提交，无需手动 SSH 进服务器。后端内置「从 Git 仓库拉取更新」能力，覆盖 `git pull`（仅 fast-forward）+ 按需 `npm install` / `npm run build` + 自重启。

**入口**：「全部模块 → 系统更新」（`/update`）。需管理员鉴权（`REQUIRE_AUTH=true` 时带 Token）。

- **当前版本**：展示运行环境（原生 Node / Docker）、分支、当前提交、是否有未提交修改。
- **检查更新**：`git fetch` 后比较 `HEAD` 与 `origin/<branch>`，显示落后/领先提交数。
- **立即更新**：ff-only 拉取 → 对比变更文件，仅当 `package*.json` 变化才重装依赖、仅当 `web/` 变化才重建前端 → 响应后**自重启**加载新代码（原生部署有效）。

**自动更新（环境变量）**：仅 `NODE_ENV=production` 由调度器按 `UPDATE_CHECK_INTERVAL_MIN`（默认 1440 分钟，每天）节流检查；落后时若 `AUTO_UPDATE_APPLY=true` 则自动拉取+重建+重启，否则仅推送「有更新」通知，需手动点升级。

**安全护栏**：
- 仅 `git pull --ff-only`，绝不自动 merge/rebase，避免覆盖本地提交或产生冲突。
- 工作区有未提交修改（被追踪文件）时**拒绝更新**，避免丢改动。
- Docker 容器内禁用「容器内 pull」（镜像层不可变，pull 不会在重建后保留）→ 页面提示改用 `docker compose pull && docker compose up -d`。

本手册为工程骨架示例，仅供学习与研究。接入真实第三方平台时请遵守其服务条款与相关法律法规。
