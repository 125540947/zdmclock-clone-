#!/usr/bin/env bash
# =============================================================================
# zdmclock-clone · 生产部署脚本（systemd 托管，自举 + idempotent 可重入）
# -----------------------------------------------------------------------------
# 这是唯一权威的部署脚本（deploy-vps.sh 已改为它的薄包装，二者等价）。
# 设计目标：从一台「裸 Debian」上，只要把本文件传上去，一条命令跑完：
#   1) 自动安装 git / curl / Node 22 LTS（缺失才装）
#   2) 获取代码：优先 git clone（--repo 带 PAT）；若已是项目目录则原地部署
#   3) npm install + 构建前端
#   4) 生成强密钥 .env（无效则备份重建）
#   5) 注册 systemd（Restart=always + SELF_UPDATE_NO_REEXEC=1，崩溃自动拉起）
#   6) 可选 nginx + Let's Encrypt 免费 TLS
#
# 关键安全/健壮性约定（避免历史上"卡在交互提示 / APP_DIR=/root"的问题）：
#   - 默认非交互、一条命令到底；但若 stdin 是终端（真人 SSH/控制台运行），会在开头
#     弹出"安装方式"菜单（部署用户 / 端口 / 是否配 nginx+TLS），被管道或重定向时自动
#     静默用默认值或命令行参数，read 还带 60s 超时，绝不卡死。
#   - APP_DIR 由脚本自身所在目录判定；若落在 /root 或 /home 下，会为该目录追加 others
#     的 x（仅遍历）位，放行部署用户 chdir，避免 systemd 在切换工作目录时 Permission denied。
#   - 任何一步失败都会明确报错并退出，不会悄悄进入危险状态。
#
# 用法（任选其一）：
#   # 你把整个仓库 scp 到 /opt/zdmclock 后，进去直接跑：
#   bash /opt/zdmclock/deploy.sh
#
#   # 或让脚本自己从 GitHub 拉私有库（PAT 需有 repo 权限）：
#   bash deploy.sh --repo https://<PAT>@github.com/125540947/zdmclock-clone-.git
#
#   bash deploy.sh --tls example.com     # 顺带配 nginx + TLS
#   bash deploy.sh --user zdm --port 3000
#   bash deploy.sh --pull                # 代码已 clone 时，先 git pull --ff-only
# =============================================================================
set -euo pipefail

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

# ---- 交互式配置（仅当 stdin 是终端时启用；被管道/重定向时静默用默认值，绝不卡死）----
INTERACTIVE=0
[ -t 0 ] && INTERACTIVE=1
if [ "$INTERACTIVE" -eq 1 ]; then
  echo "============================================================"
  echo " 交互式部署（直接回车 = 使用 [默认值]；60 秒未输入自动跳过）"
  echo "============================================================"
  _ask() { # $1=prompt $2=default -> 写回同名全局需调用方处理
    local _p="$1" _d="$2" _a=""
    if read -r -t 60 -p " $_p [$2]: " _a; then
      [ -n "$_a" ] && printf '%s' "$_a"
    else
      echo ""   # 超时/EOF：回车默认
    fi
  }
  _v="$(_ask "部署用户" "$APP_USER")"; [ -n "$_v" ] && APP_USER="$_v"
  _v="$(_ask "服务端口" "$PORT")";      [ -n "$_v" ] && PORT="$_v"
  _v="$(_ask "nginx+HTTPS 域名（留空=仅 :$PORT 直连）" "$DOMAIN")"; [ -n "$_v" ] && DOMAIN="$_v"
  echo " → 安装方式：$([ -n "$DOMAIN" ] && echo "nginx 反代 + TLS($DOMAIN)" || echo "直接 :$PORT 访问")；部署用户=$APP_USER"
  echo "------------------------------------------------------------"
fi

# ---- 定位项目目录（修复旧脚本把 APP_DIR 解析成 /root 的坑）----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/server/src/index.js" ] || [ -f "$SCRIPT_DIR/package.json" ]; then
  APP_DIR="$SCRIPT_DIR"          # 脚本就在项目目录内（scp 整库 / 已 clone 后运行）
else
  APP_DIR="/opt/zdmclock"        # 脚本被单独传到别处，则部署到固定目录并 clone
fi

echo "==> 部署目录: $APP_DIR"

# 安全护栏：禁止把项目部署到系统关键目录。
# 否则后续 `chown -R $APP_USER $APP_DIR` 会误伤家目录/系统文件（曾把 /root 改成 zdm 归属）。
case "$APP_DIR" in
  /root|/|/home|/usr|/etc|/var|/boot|/srv|/bin|/lib|/lib64|/tmp)
    echo "✗ APP_DIR=$APP_DIR 是系统关键目录，禁止在此部署（chown 会误伤系统文件）。"
    echo "  请把仓库放到独立目录，例如："
    echo "    mkdir -p /opt/zdmclock && cp -a /root/. /opt/zdmclock/ && cd /opt/zdmclock && bash deploy.sh"
    exit 1 ;;
esac

# ---- 获取代码 ----
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "==> 已有 git 仓库，更新代码"
  # M-11 修复：git pull 失败（网络/冲突/本地提交）必须中止部署，绝不能像此前 `|| true` 那样
  # 静默吞掉后继续用旧代码"成功部署"，否则运维看到"部署完成"实为运行陈旧版本。
  if [ "$DO_PULL" = "1" ]; then
    git -C "$APP_DIR" pull --ff-only || {
      echo "✗ git pull 失败，已终止部署以避免运行旧代码（请先手动 git pull 解决冲突，或用 --repo 重新克隆）。"
      exit 1
    }
  fi
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
  echo "  方案A：把你机器上的仓库 scp 到 $APP_DIR，再 bash $APP_DIR/deploy.sh"
  echo "  方案B：bash deploy.sh --repo https://<PAT>@github.com/125540947/zdmclock-clone-.git"
  exit 1
fi
cd "$APP_DIR"

echo "==> [1/6] 系统依赖与 Node 22 LTS（缺失才装）"
export DEBIAN_FRONTEND=noninteractive

# 仅当 git/curl/xz 缺失时才动用 apt-get（注意：用 apt-get 而非 apt，
# apt-get 不会触发 "apt does not have a stable CLI interface" 告警）。
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
  echo "  · 安装基础工具 git/curl/xz-utils（apt-get，安静模式）"
  apt-get update -y -qq
  apt-get install -y -qq git curl ca-certificates gnupg xz-utils
fi

# 优先复用系统已装的 Node（>=22 即可）；否则下载官方二进制包解包到 /usr/local。
# 这样做彻底避免两件事：
#   1) apt 的 "apt does not have a stable CLI interface" 告警（旧脚本用 bare apt / NodeSource 会触发）；
#   2) `curl ... | bash -` 在弱网或受限环境里挂起（NodeSource 安装脚本的隐患）。
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)"
  case "$NODE_MAJOR" in ''|*[!0-9]*) NODE_OK=0 ;; *) [ "$NODE_MAJOR" -ge 22 ] && NODE_OK=1 ;; esac
fi

if [ "$NODE_OK" -ne 1 ]; then
  NODE_VER="v22.14.0"
  NODE_TAR="node-${NODE_VER}-linux-x64.tar.xz"
  NODE_URL="https://nodejs.org/dist/${NODE_VER}/${NODE_TAR}"
  echo "  · 下载 Node ${NODE_VER} 官方二进制（无 apt、不挂起）"
  curl -fsSL --connect-timeout 20 --max-time 360 -o "/tmp/${NODE_TAR}" "$NODE_URL"
  tar -xJf "/tmp/${NODE_TAR}" -C /usr/local --strip-components=1
  rm -f "/tmp/${NODE_TAR}"
  hash -r 2>/dev/null || true
fi
node -v; npm -v

echo "==> [2/6] 创建非 root 部署用户 $APP_USER（不存在才建）"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -m -s /usr/sbin/nologin "$APP_USER"
fi

echo "==> [3/6] 安装依赖与构建前端（校验关键包，缺失才装）"
# 不能只判断 node_modules 目录是否存在：历史上有"目录在但依赖残缺"导致 npm start
# 起不来的情况。改为检查真正需要的包/可执行文件。
if [ ! -x node_modules/.bin/cross-env ] || [ ! -d node_modules/express ] \
   || [ ! -d node_modules/dotenv ] || [ ! -d node_modules/vite ]; then
  echo "  · 依赖不完整，执行 npm install"
  npm install
fi
if [ ! -f web/dist/index.html ]; then
  echo "  · 前端未构建，执行 npm run build"
  npm run build
fi
# 防御：从 Windows 拷贝的仓库 node_modules/.bin 常丢 +x，导致 vite/cross-env 报
# Permission denied（npm install 不会给已存在的文件补回 +x）。显式补回执行位。
chmod -R +x node_modules 2>/dev/null || true
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# 确保部署用户能"穿越"到 APP_DIR：若 APP_DIR 落在某用户的家目录（如 /home/ubuntu），
# 该家目录默认权限 750，部署用户无法进入，systemd 会在 chdir 阶段直接报 Permission denied，
# 导致服务永远起不来（历史上反复卡在 step 5 的根因）。这里仅给家目录追加 others 的 x
# （遍历）位，不开放读取，影响面最小，且幂等。
P="$(dirname "$APP_DIR")"
while [ "$P" != "/" ]; do
  case "$P" in
    /home/*|/root) [ -d "$P" ] && chmod o+x "$P" 2>/dev/null || true ;;
  esac
  P="$(dirname "$P")"
done

echo "==> [4/6] 生成 / 校验 .env（关键安全项）"
valid_env=0
if [ -f .env ] && grep -Eq '^ADMIN_PASSWORD=.{8,}$' .env \
                && grep -Eq '^API_TOKEN=.{8,}$' .env \
                && grep -Eq '^ADMIN_TOKEN=.{8,}$' .env \
                && grep -Eq '^REQUIRE_AUTH=true$' .env; then
  valid_env=1
fi

if [ "$valid_env" -eq 0 ]; then
  if [ -f .env ]; then
    cp .env ".env.broken.$(date +%s)" && echo "  ⚠ 检测到无效的 .env，已备份为 .env.broken.* 后重新生成"
  fi
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 24)"
  API_TOKEN="$(openssl rand -hex 24)"
  ADMIN_TOKEN="$(openssl rand -hex 24)"
  # 保留用户已显式选择的适配器（real/mock），避免重新生成时把 real 悄悄重置回 mock
  # （历史上会导致"重新部署后变回假签到"）。未设置则安全默认 mock。
  PREV_ADAPTER="$(grep -E '^SMZDM_ADAPTER=' .env 2>/dev/null | cut -d= -f2-)"
  SMZDM_ADAPTER_VAL="${PREV_ADAPTER:-mock}"
  # H-06：标准 TLS 部署（配了域名，走 nginx 反代）下，后端位于反代之后，必须开启 TRUST_PROXY
  # （让 req.secure 正确识别 HTTPS），并对会话 Cookie 加 Secure，避免签发的 API/Admin 会话 Cookie
  # 在 HTTP 链路/降级中被发送。直连 http 部署保持关闭（自托管 http 场景 Cookie 需可被发送）。
  if [ -n "$DOMAIN" ]; then
    ZDM_TRUST_PROXY="TRUST_PROXY=true"
    ZDM_COOKIE_SECURE="COOKIE_SECURE=1"
  else
    ZDM_TRUST_PROXY="TRUST_PROXY=false"
    ZDM_COOKIE_SECURE="COOKIE_SECURE=0"
  fi
  cat > .env <<ZDM_ENV_EOF
PORT=$PORT
NODE_ENV=production
REQUIRE_AUTH=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
API_TOKEN=$API_TOKEN
ADMIN_TOKEN=$ADMIN_TOKEN
SMZDM_ADAPTER=$SMZDM_ADAPTER_VAL
$ZDM_TRUST_PROXY
$ZDM_COOKIE_SECURE
AUTO_UPDATE_APPLY=false
UPDATE_CHECK_INTERVAL_MIN=1440
SELF_UPDATE_NO_REEXEC=1
CORS_ORIGIN=
DATA_DIR=$APP_DIR/data
WEB_DIST=$APP_DIR/web/dist
ZDM_TZ=Asia/Shanghai
ZDM_ENV_EOF
  chown "$APP_USER":"$APP_USER" .env
  chmod 600 .env
  echo "=========================================================="
  echo "  管理员密码(请立即记录): $ADMIN_PASSWORD"
  echo "  API_TOKEN(请立即记录):  $API_TOKEN"
  echo "  ADMIN_TOKEN(请立即记录): $ADMIN_TOKEN"
  echo "=========================================================="
else
  echo "  .env 已存在且有效，沿用现有配置。"
fi

echo "==> [5/6] 注册 systemd 服务（崩溃自动重启；禁用应用内 re-exec）"
# 解析 npm 绝对路径：二进制 Node 装在 /usr/local/bin，而 systemd 默认 PATH 常不含该目录，
# 若直接用 `npm start` 会出现 "npm: command not found"。这里写死 PATH 与 npm 绝对路径。
NPM_BIN="$(command -v npm || echo /usr/local/bin/npm)"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT_EOF
[Unit]
Description=zdmclock smzdm 自动化助手
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
# 显式 PATH，确保能找到装到 /usr/local/bin 的 node/npm
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin:/sbin
ExecStart=$NPM_BIN start
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
  apt-get install -y -qq nginx certbot python3-certbot-nginx
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
