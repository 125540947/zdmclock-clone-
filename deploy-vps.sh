#!/usr/bin/env bash
# =============================================================================
# zdmclock-clone · VPS 生产部署脚本（systemd 托管，idempotent 可重入）
# -----------------------------------------------------------------------------
# 关键修复：
#   - 不依赖「复制粘贴长脚本」（容易丢换行导致命令错乱）；本脚本作为文件存在仓库，
#     在 VPS 上 `git pull` 后 `bash deploy-vps.sh` 即可运行。
#   - 可重入：依赖/前端产物/系统用户/服务已存在时自动跳过，可反复安全执行。
#   - 修复被截断的半截 .env：检测到 .env 无效会自动备份并重新生成强密钥。
#   - 使用 systemd（Restart=always）+ SELF_UPDATE_NO_REEXEC=1：崩溃自动拉起，
#     且「系统更新」页点升级时应用只退出、由 systemd 重启，不产生孤儿进程。
#
# 用法：
#   bash deploy-vps.sh                 # IP:PORT 访问（无 TLS，Cookie 明文）
#   bash deploy-vps.sh --tls example.com   # 自动配 nginx + Let's Encrypt 免费 TLS
#   bash deploy-vps.sh --pull          # 运行前先 git pull --ff-only
#   bash deploy-vps.sh --user zdm --port 3000
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

APP_USER="${APP_USER:-zdm}"
PORT="${PORT:-3000}"
SERVICE="zdmclock"
DOMAIN=""
DO_PULL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tls)  DOMAIN="$2"; shift 2 ;;
    --user) APP_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --pull) DO_PULL=1; shift ;;
    *) shift ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "✗ 请用 root 运行本脚本（systemd 需要特权）。"; exit 1; }

if [ "$DO_PULL" = "1" ]; then
  echo "==> 拉取最新代码"
  git -C "$APP_DIR" pull --ff-only || echo "  ⚠ git pull 失败（可能无网络或需先 push），继续用现有代码"
fi

echo "==> [1/6] 系统依赖与 Node 22 LTS（缺失才装）"
export DEBIAN_FRONTEND=noninteractive
NODE_MAJOR="$(node -v 2>/dev/null | cut -d. -f1 | tr -d v || echo 0)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  apt-get update -y
  apt-get install -y -q git curl ca-certificates gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v; npm -v

echo "==> [2/6] 创建非 root 部署用户 $APP_USER（不存在才建）"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -s /usr/sbin/nologin "$APP_USER"
fi

echo "==> [3/6] 安装依赖与构建前端（按需）"
[ -d node_modules ] || npm install
[ -d web/dist ] || npm run build
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> [4/6] 生成 / 校验 .env（关键安全项）"
valid_env=0
if [ -f .env ] && grep -Eq '^ADMIN_PASSWORD=.{8,}$' .env \
                && grep -Eq '^API_TOKEN=.{8,}$' .env \
                && grep -Eq '^REQUIRE_AUTH=true$' .env; then
  valid_env=1
fi

if [ "$valid_env" -eq 0 ]; then
  if [ -f .env ]; then
    cp .env ".env.broken.$(date +%s)" && echo "  ⚠ 检测到无效的 .env，已备份为 .env.broken.* 后重新生成"
  fi
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 24)"
  API_TOKEN="$(openssl rand -hex 24)"
  cat > .env <<ZDM_ENV_EOF
PORT=$PORT
NODE_ENV=production
REQUIRE_AUTH=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
API_TOKEN=$API_TOKEN
SMZDM_ADAPTER=mock
AUTO_UPDATE_APPLY=false
UPDATE_CHECK_INTERVAL_MIN=1440
SELF_UPDATE_NO_REEXEC=1
CORS_ORIGIN=
DATA_DIR=$APP_DIR/data
WEB_DIST=$APP_DIR/web/dist
ZDM_ENV_EOF
  chown "$APP_USER":"$APP_USER" .env
  chmod 600 .env
  echo "=========================================================="
  echo "  管理员密码(请立即记录): $ADMIN_PASSWORD"
  echo "  API_TOKEN(请立即记录):  $API_TOKEN"
  echo "=========================================================="
else
  echo "  .env 已存在且有效，沿用现有配置。"
fi

echo "==> [5/6] 注册 systemd 服务（崩溃自动重启；禁用应用内 re-exec）"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT_EOF
[Unit]
Description=zdmclock smzdm 自动化助手
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SELF_UPDATE_NO_REEXEC=1

[Install]
WantedBy=multi-user.target
UNIT_EOF
systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  echo "  $SERVICE 运行中 ✅"
else
  echo "  ❌ 启动失败，查看: journalctl -u $SERVICE -e"
  exit 1
fi

if [ -n "$DOMAIN" ]; then
  echo "==> [6/6] 配置 nginx + TLS（$DOMAIN）"
  apt-get install -y -q nginx certbot python3-certbot-nginx
  cat > "/etc/nginx/sites-available/$SERVICE" <<NGX_EOF
server {
  listen 80;
  server_name $DOMAIN;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGX_EOF
  ln -sf "/etc/nginx/sites-available/$SERVICE" "/etc/nginx/sites-enabled/$SERVICE"
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" \
    || echo "  ⚠ certbot 失败，请手动处理 TLS（域名解析/端口 80 需就绪）"
fi

echo "==> 完成。访问：${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$(hostname -I | awk '{print $1}'):$PORT}"
echo "==> 首次登录：管理员账号 admin / 上面生成的密码；之后在「系统更新」页可手动升级。"
