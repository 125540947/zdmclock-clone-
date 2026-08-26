# 部署侧安全评审 · deploy.sh / Dockerfile（2026-08-26）

> 范围：对生产部署链路做独立安全评审，聚焦三项——**密钥注入**、**最小权限**、**默认绑定地址**。
> 配套代码改动：`server/src/taskRunner.js` 已打破 `taskRunner↔startup` 循环依赖（见 §4），`Dockerfile` 加 `HEALTHCHECK`，`deploy.sh` 直连模式补暴露面说明。

## 1. 结论速览

| 维度 | 评级 | 结论 |
|------|------|------|
| 密钥注入 | ✅ 良好 | 强随机生成、`chmod 600`、属主非 root；仅有「控制台明文回显」与「旧 .env 备份留存明文」两处低风险项 |
| 最小权限 | ✅ 良好 | 非 root 部署用户（`nologin`）+ systemd 以其运行 + `chown -R`；Docker 运行阶段非 root（`nodejs`） |
| 默认绑定 | ⚠️ 需关注 | TLS 模式已回退 `127.0.0.1`（优）；**直连模式默认 `0.0.0.0`**，暴露面最大，依赖 `REQUIRE_AUTH=true` 单一防线 |

整体基线良好，无高危部署侧缺陷。唯一需用户拍板的是「直连模式默认 `0.0.0.0`」是否改为 secure-by-default 的 `127.0.0.1`（见 §3 权衡）。

## 2. 密钥注入（Secret Injection）

**已实现（优）：**
- 强密钥：`ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -dc A-Za-z0-9 | head -c 24)`、`API_TOKEN/ADMIN_TOKEN=$(openssl rand -hex 24)`（`deploy.sh:240-242`）。
- 权限收敛：`.env` 生成后 `chown $APP_USER:$APP_USER` + `chmod 600`（`deploy.sh:294-295`），仅属主可读。
- 复用而非轮换：既有 ≥8 位强密钥时复用，避免每次重部署更换登录凭据（`deploy.sh:221-244`）。
- 适配器保留：不把 `real` 偷偷重置回 `mock`（`deploy.sh:247`）。
- 安全字段迁移：每次部署按本次参数重新物化 `TRUST_PROXY/COOKIE_SECURE/BIND_ADDRESS/...`，避免升级后缺失（`deploy.sh:210-271`）。
- Docker：`.dockerignore` 已排除 `.env`/`server/data`/`*.db`/`.claude`，镜像不含凭据与本地数据。

**可改进（低风险，非阻断）：**
- L1 控制台回显：部署时把管理员密码 / Token `echo` 到终端（`deploy.sh:296-300`）。在多用户共享终端或进程列表（`ps`）可见的场景下会短暂泄露。建议改为「仅写入 `.env` 与首次部署日志文件，终端只提示『已生成，请查看 .env』」，或部署后 `read -s` 二次确认。当前为一次性初始化、可接受。
- L2 旧 `.env` 备份：检测到弱/无效密钥时 `cp .env .env.broken.*`（`deploy.sh:238`），旧明文密钥留在应用目录。建议备份后立即 `chmod 600` 且属主一致（当前沿用新建逻辑，已 `chmod 600` 在末尾统一执行，但 `.env.broken.*` 未单独收敛——补一句 `chmod 600 .env.broken.*` 即可）。低风险。

## 3. 最小权限（Least Privilege）

**已实现（优）：**
- 非 root 部署用户：`useradd -r -m -s /usr/sbin/nologin "$APP_USER"`（`deploy.sh:161-163`），systemd `User=$APP_USER` 运行（`deploy.sh:313`）。
- 数据/代码属主：`chown -R "$APP_USER":"$APP_USER" "$APP_DIR"`（`deploy.sh:196`）。
- 安全护栏：禁止部署到 `/root|/|/home|/usr|...` 等系统目录（`deploy.sh:90-96`），防止 `chown` 误伤系统文件。
- Docker 运行阶段：`adduser -S nodejs`（非 root）+ `npm ci --omit=dev`（不装 vite/vue 等构建工具）+ `USER nodejs`（`Dockerfile:20-34`）。
- 显式 PATH：`Environment=PATH=...` 确保找到 `/usr/local/bin` 的 node/npm（`deploy.sh:316`），避免 `npm: command not found`。

**可改进（低风险）：**
- 构建阶段仍以 root 跑 `npm run build`（`Dockerfile` build 阶段未切用户）。属常态做法、无产物风险（仅构建期），可不改。
- systemd 未设 `NoNewPrivileges=yes` / `ProtectSystem=strict` 等沙箱指令。若追求更强隔离可加，但需评估 `data/` 写权限（已用 `DATA_DIR` 指向应用目录内，可行）。属加固增量，非必须。

## 4. 默认绑定地址（Bind Address）

**TLS 模式（优）：** `--tls` 时 `BIND_ADDRESS=127.0.0.1` + `TRUST_PROXY=true` + `PROXY_TRUSTED_SUBNET=loopback`（`deploy.sh:257-262`），后端仅本机可达，由 nginx 反代对外，且 XFF 仅信任 loopback → 直连外部客户端无法伪造 XFF。符合纵深防御。

**直连模式（需关注）：** 未配 `--tls` 时 `BIND_ADDRESS=0.0.0.0`（`deploy.sh:269`），监听所有接口。
- 缓解：`REQUIRE_AUTH` 默认 `true`（审计批次 8 已 secure-by-default），是唯一外部防线；`CORS_ORIGIN=` 空（CORS 默认关闭）。
- 风险：公网 VPS 上 `0.0.0.0` 直接暴露到互联网，攻击面最大；一旦 `REQUIRE_AUTH` 被误配 `false`（或未来某次改动破坏默认），即裸奔。
- 已补说明：`deploy.sh` 直连分支现注明「0.0.0.0 暴露面最大，务必保持 `REQUIRE_AUTH=true`，公网 VPS 建议改用 `--tls` 或前置防火墙仅放行受信赖网段；仅需本机访问可手动改 `127.0.0.1`」。

**决策（2026-08-26 已采纳方案 A · secure-by-default）：**
- 直连模式（无 `--tls`）**默认 `BIND_ADDRESS=127.0.0.1`**（最小暴露面，仅本机可达）；需局域网/公网直连时显式加 **`--expose`** 才放开到 `0.0.0.0`，并打印安全提示要求 `REQUIRE_AUTH=true` + 防火墙。
- Docker 容器内：保持 `0.0.0.0`（容器内监听），由 `docker run -p 127.0.0.1:3000:3000` 或前置反代控制对外暴露（不宜在容器内改 `127.0.0.1`，会切断同网络反代）。

> 该改动仅影响**未来**重跑 `deploy.sh` 时的默认行为；当前 VPS（`124.222.218.174`）经 git bundle 直推、不经 `deploy.sh`，其 `.env` 仍维持既有的 `BIND_ADDRESS=0.0.0.0`，**现存运行服务不受影响**。若日后想让 VPS 也收口到回环，需手动将 `.env` 的 `BIND_ADDRESS` 改为 `127.0.0.1` 并 `systemctl restart zdmclock`（或加 nginx 反代 + TLS）。

## 5. 附：本轮配套代码改动

- `server/src/taskRunner.js`：`startup` 分支由静态 `import { runStartupForAccounts }` 改为运行时 `await import('./startup.js')`，打破 `taskRunner↔startup` 静态循环依赖（行为不变，模块图转为有向无环，单测隔离改善）。新增回归测试 `runTask(type=startup)` 委派行为（位于 `server/test/taskRunner.test.js`），全量 454/454 通过。
- `Dockerfile`：运行阶段新增 `HEALTHCHECK`（回环探测根路径 liveness）。
- `deploy.sh`：直连模式默认改 `BIND_ADDRESS=127.0.0.1`（secure-by-default），新增 `--expose` 标志显式放开 `0.0.0.0` 并打印安全提示（含旧 `.env` 备份 `chmod 600`）。
