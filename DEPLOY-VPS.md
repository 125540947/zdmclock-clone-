# 部署到 VPS（加固版运行手册）

> 目标机：`124.222.218.174`（公网 IP）。本手册默认 **Ubuntu/Debian**，root 登录。
> 本沙箱无外网出口，无法替你 SSH / `git push`。但你**自己的机器**（运行 WorkBuddy 的 Windows / Mac）可以直连 VPS，
> 所以下面用 **scp 把仓库传上去** 的方式，完全不依赖 GitHub 推送或 PAT，最省事。

---

## 0. 上线前必读的安全红线（勿跳过）

本项目**默认 `REQUIRE_AUTH=false`**——所有写接口与"系统更新"接口**免鉴权**。在公网 IP 上原样部署 = 任何人都能触发 `git pull + npm install + 重启`（供应链/RCE 相邻风险），且 smzdm Cookie 可被未授权读取。**本手册的部署脚本已强制开启鉴权**；如果你手动改配置，务必保持以下三条：

- `REQUIRE_AUTH=true`
- `ADMIN_PASSWORD` 为强随机值（脚本自动生成并回显，**请立即记下来**）
- `API_TOKEN` 为固定强随机值（脚本自动生成；前端登录 / 调用接口用）

另外，因 root 密码已在聊天中明文出现，**部署后请立即改 root 密码**，并建议改为 SSH 密钥登录、禁用密码/root 直登。

---

## 1. 部署步骤（推荐：scp 传仓库，无需 GitHub）

> ⚠️ **不要再复制粘贴文档里那一长串多行脚本**——换行极易在终端里丢失导致命令错乱（你已踩过坑）。
> 改为 **scp 把整个仓库传到 VPS**，然后 `bash deploy-vps.sh` 一条命令跑完。脚本会自动装 Node 22、构建、起 systemd。

### 1.0 退出卡住的旧脚本

你刚才卡在 `bash ./deploy.sh` 的 `read` 交互等待，先按 **`Ctrl + C`** 退出它（不要回车选 Docker，那会因没装 docker 失败）。

### 1.1 在你自己的机器上，把仓库 scp 到 VPS（保留 .git，排除大目录）

在**你本机**打开终端（Windows 用 Git Bash / PowerShell；仓库就在 WorkBuddy 目录里），执行：

```bash
# Windows Git Bash 示例（路径换成你实际的 zdmclock-clone 目录）
REPO="/c/Users/1/WorkBuddy/2026-08-04-08-27-18/zdmclock-clone"
ssh root@124.222.218.174 "mkdir -p /opt/zdmclock"
scp -r -o StrictHostKeyChecking=no \
  "$REPO"/.git \
  "$REPO"/server "$REPO"/web "$REPO"/package.json "$REPO"/package-lock.json \
  "$REPO"/deploy-vps.sh "$REPO"/.env.example \
  root@124.222.218.174:/opt/zdmclock/
```

> 说明：只传源码与 `.git`（保留 git 历史，方便日后「系统更新」页自动拉取）；**不传** `node_modules` / `web/dist`（脚本会自动装、自动构建）。若你本机已有 `.env`，不要传（脚本会生成新的强密钥）。

### 1.2 在 VPS 上运行部署脚本

```bash
ssh root@124.222.218.174
bash /opt/zdmclock/deploy-vps.sh            # IP:PORT 访问（无 TLS）
# 有域名想免费 HTTPS： bash /opt/zdmclock/deploy-vps.sh --tls your.domain.com
```

脚本会依次：装 Node 22 LTS（缺失才装）→ 建非 root 用户 → 装依赖/构建（已有则跳过）→
生成强密钥 `.env`（无效则备份重建）→ 注册 systemd（`Restart=always` + `SELF_UPDATE_NO_REEXEC=1`）→ 可选 nginx+TLS。
运行结束会**回显管理员密码与 API_TOKEN，请立即记下**。

---

## 2. 收尾安全项（手动）

1. **改 root 密码**（聊天中已明文）：`passwd root`
2. **SSH 加固**：编辑 `/etc/ssh/sshd_config` → `PermitRootLogin prohibit-password`、`PasswordAuthentication no`，部署公钥后 `systemctl restart sshd`。
3. **防火墙**：仅放行 80/443（及你管理的 SSH 端口），例如 `ufw allow 443; ufw allow 80; ufw enable`。
4. **Cookie 数据**：`$APP_DIR/data` 含 smzdm Cookie，`$APP_DIR/.env` 含密钥，均已 `chmod 600` 且仅 app 用户可读；切勿提交进仓库（`.env`、`data/` 应在 `.gitignore`）。

---

## 3. 日常运维

```bash
systemctl status zdmclock          # 状态
journalctl -u zdmclock -f          # 日志
# 升级（二选一）：
#   A. 前端「系统更新」页点「立即更新」（已设 SELF_UPDATE_NO_REEXEC=1，应用退出后由 systemd 拉起加载新代码）
#   B. 命令行：cd /opt/zdmclock && git pull --ff-only && npm install && npm run build && systemctl restart zdmclock
# 回滚：git log 找旧提交 hash → git checkout <hash> && npm run build && systemctl restart zdmclock
```

> 说明：因已设 `SELF_UPDATE_NO_REEXEC=1`，**不要**再开 `AUTO_UPDATE_APPLY=true` 做全自动更新——建议保持手动，避免破坏性提交在无人值守时上线。若确需全自动，请先确保有快照/回滚预案。

---

## 4. 已知待修（见 AUDIT.md）

- **H2**：更新接口仅通用 Token 鉴权、未做管理员隔离；当前靠 `REQUIRE_AUTH=true` + 单管理员兜底，建议后续引入独立 `ADMIN_TOKEN`。
- **M1**：「立即更新」同步阻塞到构建完成（分钟级），前端有 4s 自动刷新兜底；生产大构建时可能偶发客户端超时提示（实际已更新）。
- **M3**：工作区含未跟踪文件时拒绝自助更新（属安全保守策略）。
