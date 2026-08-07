# 部署到 VPS（加固版运行手册）

> 目标机：`124.222.218.174`（公网 IP）。本手册默认 **Ubuntu/Debian**，root 登录。
> 重要前提：本沙箱无外网出口，无法替你 `git push` / SSH。请先在**你自己的机器**把最新提交（`e8652cc`，含 `SELF_UPDATE_NO_REEXEC`）推到 GitHub，VPS 才能 `git pull` 到它：
> ```bash
> git push            # 在你本机执行
> ```
> 若仓库是**私有**的，VPS 上 `git clone` 需要认证：用 GitHub PAT（勾 repo 权限）或部署 SSH 密钥。

---

## 0. 上线前必读的安全红线（勿跳过）

本项目**默认 `REQUIRE_AUTH=false`**——所有写接口与"系统更新"接口**免鉴权**。在公网 IP 上原样部署 = 任何人都能触发 `git pull + npm install + 重启`（供应链/RCE 相邻风险），且 smzdm Cookie 可被未授权读取。**本手册的部署脚本已强制开启鉴权**；如果你手动改配置，务必保持以下三条：

- `REQUIRE_AUTH=true`
- `ADMIN_PASSWORD` 为强随机值（脚本自动生成并回显，**请立即记下来**）
- `API_TOKEN` 为固定强随机值（脚本自动生成；前端登录 / 调用接口用）

另外，因 root 密码已在聊天中明文出现，**部署后请立即改 root 密码**，并建议改为 SSH 密钥登录、禁用密码/root 直登。

---

## 1. 在 VPS 上执行（文件方式，无需复制长脚本）

> ⚠️ **不要再复制粘贴文档里那一长串多行脚本**——换行极易在终端里丢失，导致命令错乱（你已经踩过这个坑了）。
> 改用**文件方式**：脚本已落地为仓库里的 `deploy-vps.sh`，你只需 `git pull` 后 `bash deploy-vps.sh` 一条命令跑完。

### 1.1 如果你刚才已经跑到一半（卡在 .env 生成）

你现在是 `bash-5.2#` 提示符，正常现象。脚本在 `cat > .env <<EOF` 处断了，`.env` 可能写成了半截/空文件。按下面「1.2」重跑即可：`deploy-vps.sh` 会**检测到 .env 无效 → 自动备份为 `.env.broken.*` → 重新生成强密钥**，不影响之前已完成的 clone/装依赖/构建。

### 1.2 干净步骤（在 VPS 的 root shell）

```bash
# 如果你之前是手动 clone 到 /opt/zdmclock（默认），请进该目录；其它路径改之
cd /opt/zdmclock
git pull                                  # 取回含 deploy-vps.sh 的最新提交
bash deploy-vps.sh                        # IP:PORT 访问（无 TLS）
# 若你有域名想免费 HTTPS： bash deploy-vps.sh --tls your.domain.com
```

脚本会依次：装 Node 22 LTS（缺失才装）→ 建非 root 用户 → 装依赖/构建（已有则跳过）→
生成强密钥 `.env`（无效则重建）→ 注册 systemd（`Restart=always` + `SELF_UPDATE_NO_REEXEC=1`）→ 可选 nginx+TLS。
运行结束会**回显管理员密码与 API_TOKEN，请立即记下**。

> 私有仓库：VPS 上 `git pull` 需认证（GitHub PAT 或部署 SSH 密钥）。

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
