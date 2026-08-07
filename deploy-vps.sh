#!/usr/bin/env bash
# =============================================================================
# zdmclock-clone · VPS 生产部署脚本（systemd 托管，自举 + idempotent 可重入）
# -----------------------------------------------------------------------------
# 设计目标：从一台「裸 Debian」上，只要把本文件传上去，一条命令跑完：
#   1) 自动安装 git / curl / Node 22 LTS（缺失才装）
#   2) 获取代码：优先 git clone（--repo 带 PAT）；若已是项目目录则原地部署
#   3) npm install + 构建前端
#   4) 生成强密钥 .env（无效则备份重建）
#   5) 注册 systemd（Restart=always + SELF_UPDATE_NO_REEXEC=1，崩溃自动拉起）
#   6) 可选 nginx + Let's Encrypt 免费 TLS
# 全程非交互、不读终端输入，避免卡在交互提示。
#
# 用法（任选其一）：
#   # 你把整个仓库 scp 到 /opt/zdmclock 后，进去直接跑：
#   bash /opt/zdmclock/deploy-vps.sh
#
#   # 或让脚本自己从 GitHub 拉私有库（PAT 需有 repo 权限）：
#   bash deploy-vps.sh --repo https://<PAT>@github.com/125540947/zdmclock-clone-.git
#
#   bash deploy-vps.sh --tls example.com     # 顺带配 nginx + TLS
#   bash deploy-vps.sh --user zdm --port 3000
#   bash deploy-vps.sh --pull                # 代码已 clone 时，先 git pull --ff-only
# =============================================================================
set -uo pipefail

# ---- 解析参数 ----
APP_USER="${APP_USER:-zdm}"
PORT="${PORT:-3000}"
SERVICE="zdmclock"
DOMAIN=""
DO_PULL=0
REPO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tls)   DOMAIN="$2"; shift 2 ;;
    --user)  APP_USER="$2"; shift 2 ;;
    --port)  PORT="$2"; shift 2 ;;
    --repo)  REPO="$2"; shift 2 ;;
    --pull)  DO_PULL=1; shift ;;
    *) shift ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "✗ 请用 root 运行本脚本（systemd 需要特权）。"; exit 1; }

# ---- 定位项目目录（修复旧脚本把 APP_DIR 解析成 /root 的坑）----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/server/src/index.js" ] || [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"          # 脚本就在项目目录内（scp 整库 / 已 clone 后运行）
else
  APP_DIR="/opt/zdmclock"        # 脚本被单独传到别处，则部署到固定目录并 clone
fi

echo "==> 部署目录: $APP_DIR"

# ---- 获取代码 ----
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "==> 已有 git 仓库，更新代码"
  [ "$DO_PULL" = "1" ] && git -C "$APP_DIR" pull --ff-only || true
elif [ -f "$APP_DIR/server/src/index.js" ]; then
  echo "==> 检测到项目文件，原地部署（未检测到 .git，自动更新功能将不可用，可稍后 git init 配置 remote）"
elif [ -n "$REPO" ]; then
  echo "==> 从仓库克隆代码"
  if [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
    mv "$APP_DIR" "${APP_DIR}.bak.$(date +%s)"
    mkdir -p "$APP_DIR"
  fi
  git clone "$REPO" "$APP_DIR"
else
  echo "✗ 未在 $APP_DIR 找到项目代码，也未提供 --repo。"
  echo "  方案A：把你机器上的仓库 scp 到 $APP_DIR，再 bash $APP_DIR/deploy-vps.sh"
  echo "  方案B：bash deploy-vps.sh --repo https://<PAT>@github.com/125540947/zdmclock-clone-.git"
  exit 1
fi
cd "$APP_DIR"

echo "==> [1/6] 系统依赖与 Node 22 LTS（缺失才装）"
export DEBIAN_FRONTEND=noninteractive
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] || [ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" -lt 22 ]; then
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
