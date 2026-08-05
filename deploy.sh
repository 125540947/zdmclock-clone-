#!/usr/bin/env bash
#
# zdmclock-clone 增强版一键部署脚本
# ----------------------------------------------------------------------------
# 增强能力：
#   1. 环境自检   —— 检测操作系统/版本、CPU 架构、已装运行环境（docker/node/npm/git/curl/wget）
#   2. 交互选择   —— 让用户自行选择部署方式：Docker（推荐）/ 原生 Node.js / 仅诊断
#   3. 自动补齐   —— 根据所选方式与检测结果，自动安装缺失依赖（支持的平台上），否则给出手动命令
#   4. 智能配置   —— 缺失 .env 时基于 .env.example 自动生成，并提示关键安全项
#   5. 健康检查   —— 启动后探测 /api/health，确认服务真正可用
#   6. 自动下载源码 —— 当前目录无源码时自动 git clone（私有仓库需 git 凭据；可用 ZDC_REPO_URL 覆盖地址）
#
# 用法： chmod +x deploy.sh && ./deploy.sh
#       也可单独下载本脚本后在空目录直接运行，它会自动拉取项目源码再部署
# ----------------------------------------------------------------------------

# 不用 set -e：交互输入、网络探测、自动安装都可能返回非 0，需手动判断，避免误退出
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR" || { echo "无法进入脚本目录，退出。"; exit 1; }

# ---------- 颜色（仅在终端启用，管道/重定向时关闭）----------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_BOLD=$'\033[1m'
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""; C_BOLD=""
fi

info(){ echo "${C_CYAN}==>${C_RESET} $*"; }
ok(){ echo "${C_GREEN}✓${C_RESET} $*"; }
warn(){ echo "${C_YELLOW}!${C_RESET} $*"; }
err(){ echo "${C_RED}✗${C_RESET} $*"; }
step(){ echo ""; echo "${C_BOLD}>> $*${C_RESET}"; }

# ---------- 1. 检测操作系统与架构 ----------
detect_os(){
  OS_TYPE="$(uname -s 2>/dev/null || echo unknown)"
  OS_ARCH="$(uname -m 2>/dev/null || echo unknown)"
  OS_NAME="unknown"; OS_VER="unknown"
  case "$OS_TYPE" in
    Linux*)
      if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS_NAME="${NAME:-Linux}"
        OS_VER="${VERSION_ID:-unknown}"
      fi
      ;;
    Darwin*)
      OS_TYPE="macOS"; OS_NAME="macOS"
      OS_VER="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      OS_TYPE="Windows"; OS_NAME="Windows"
      OS_VER="$(cmd //c ver < /dev/null 2>/dev/null | tr -d '\r' | tail -1 || echo unknown)"
      ;;
  esac
}

# ---------- 2. 检测已安装工具 ----------
has(){ command -v "$1" >/dev/null 2>&1; }

detect_tools(){
  DOCKER_BIN=""; COMPOSE_VER=""; NODE_BIN=""; NODE_VER=""; NPM_BIN=""; NPM_VER=""; GIT_BIN=""; CURL_BIN=""; WGET_BIN=""
  if has docker; then
    DOCKER_BIN="$(command -v docker)"
    COMPOSE_VER="$(docker compose version 2>/dev/null | head -1 | sed 's/.*version //' || echo n/a)"
  fi
  if has node; then NODE_BIN="$(command -v node)"; NODE_VER="$(node -v 2>/dev/null || echo n/a)"; fi
  if has npm;  then NPM_BIN="$(command -v npm)";  NPM_VER="$(npm -v 2>/dev/null || echo n/a)"; fi
  has git  && GIT_BIN="$(command -v git)"
  has curl && CURL_BIN="$(command -v curl)"
  has wget && WGET_BIN="$(command -v wget)"
}

detect_pkg(){
  PKG="none"
  if has brew;      then PKG="brew";
  elif has apt-get; then PKG="apt";
  elif has dnf;     then PKG="dnf";
  elif has yum;     then PKG="yum";
  elif has apk;     then PKG="apk";
  fi
}

# ---------- 3. 打印检测报告 ----------
print_report(){
  step "环境检测结果"
  echo "  操作系统 : $OS_NAME $OS_VER ($OS_TYPE)"
  echo "  系统架构 : $OS_ARCH"
  echo "  Docker   : ${DOCKER_BIN:-未安装}${COMPOSE_VER:+  (compose $COMPOSE_VER)}"
  echo "  Node.js  : ${NODE_BIN:-未安装}${NODE_VER:+  $NODE_VER}"
  echo "  npm      : ${NPM_BIN:-未安装}${NPM_VER:+  $NPM_VER}"
  echo "  git      : ${GIT_BIN:-未安装}"
  echo "  curl     : ${CURL_BIN:-未安装}"
  echo "  wget     : ${WGET_BIN:-未安装}"
}

# ---------- 4. 交互选择部署方式 ----------
choose_mode(){
  echo ""
  step "请选择部署方式"
  echo "  1) Docker 部署（推荐）—— 环境隔离最干净，自动处理全部依赖，换机器无坑"
  echo "  2) 原生 Node.js 部署 —— 无需 Docker，直接在机器上运行（需 Node.js >= 20）"
  echo "  3) 仅生成环境检测报告，不部署"
  printf "  请输入数字 [1]: "
  read -r MODE
  MODE="${MODE:-1}"
  case "$MODE" in
    1) MODE="docker" ;;
    2) MODE="node" ;;
    3) MODE="diagnose" ;;
    *) warn "无效输入，默认使用 Docker"; MODE="docker" ;;
  esac
}

confirm_install(){
  # $1 = 待安装组件描述
  printf "  是否允许脚本自动安装 %s？（需要管理员/sudo 权限）[Y/n]: " "$1"
  read -r ANS
  case "$ANS" in
    n|N) return 1 ;;
    *) return 0 ;;
  esac
}

# ---------- 5. 依赖补齐 ----------
install_docker(){
  # 仅 Linux 可用官方脚本自动装；Mac/Windows 必须手动装桌面版
  if [ "$OS_TYPE" = "Windows" ] || [ "$OS_TYPE" = "macOS" ]; then
    err "当前系统需手动安装 Docker Desktop："
    [ "$OS_TYPE" = "Windows" ] && echo "    https://www.docker.com/products/docker-desktop/" || echo "    https://www.docker.com/products/docker-desktop/"
    return 1
  fi
  confirm_install "Docker" || { warn "已跳过。请手动安装 Docker 后重新运行脚本。"; return 1; }
  info "通过官方脚本安装 Docker ..."
  if has curl; then
    curl -fsSL https://get.docker.com | ${SUDO:-sudo} sh || return 1
  elif has wget; then
    wget -qO- https://get.docker.com | ${SUDO:-sudo} sh || return 1
  else
    err "缺少 curl/wget，无法自动安装，请手动安装 Docker。"; return 1
  fi
  ${SUDO:-sudo} systemctl enable docker 2>/dev/null
  ${SUDO:-sudo} systemctl start docker 2>/dev/null
  return 0
}

node_major_ok(){
  # NODE_VER 形如 v20.5.0 -> 取主版本号比较
  local v="${NODE_VER#v}"; local major="${v%%.*}"
  [ "${major:-0}" -ge 20 ] 2>/dev/null
}

install_node(){
  if [ "$OS_TYPE" = "Windows" ]; then
    err "Windows 请手动安装 Node.js LTS：https://nodejs.org/ （选 20 或以上版本）"
    return 1
  fi
  confirm_install "Node.js (>=20)" || { warn "已跳过。请手动安装后重新运行脚本。"; return 1; }
  info "通过 $PKG 安装 Node.js 20 ..."
  case "$PKG" in
    brew)
      brew install node || return 1 ;;
    apt)
      ${SUDO:-sudo} apt-get update -y
      if has curl; then curl -fsSL https://deb.nodesource.com/setup_20.x | ${SUDO:-sudo} bash -
      else err "缺少 curl，无法添加 NodeSource 源"; return 1; fi
      ${SUDO:-sudo} apt-get install -y nodejs || return 1 ;;
    dnf|yum)
      if has curl; then curl -fsSL https://rpm.nodesource.com/setup_20.x | ${SUDO:-sudo} bash -
      else err "缺少 curl，无法添加 NodeSource 源"; return 1; fi
      ${SUDO:-sudo} "$PKG" install -y nodejs || return 1 ;;
    apk)
      ${SUDO:-sudo} apk add --no-cache nodejs npm || return 1 ;;
    *)
      err "未知包管理器，请手动安装 Node.js >= 20：https://nodejs.org/"; return 1 ;;
  esac
  return 0
}

ensure_docker(){
  if ! has docker; then
    warn "未检测到 Docker，尝试补齐 ..."
    if ! install_docker; then err "Docker 不可用，部署中止。"; exit 1; fi
    detect_tools
  fi
  if ! docker compose version >/dev/null 2>&1; then
    err "docker compose 不可用（Docker 版本过旧）。请升级 Docker 后重跑。"
    exit 1
  fi
  ok "Docker 环境就绪（compose $COMPOSE_VER）"
}

ensure_node(){
  if ! has node; then
    warn "未检测到 Node.js，尝试补齐 ..."
    if ! install_node; then err "Node.js 不可用，部署中止。"; exit 1; fi
    detect_tools
  fi
  if ! node_major_ok; then
    err "Node.js 版本过低（当前 ${NODE_VER}，需 >= 20）。请升级后重跑。"
    exit 1
  fi
  ok "Node.js 环境就绪（${NODE_VER}）"
}

# ---------- 6. 生成配置 ----------
setup_env(){
  if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then err "缺少 .env.example，无法生成配置，退出。"; exit 1; fi
    cp .env.example .env
    info "已根据 .env.example 生成 .env（默认演示模式 mock，本地零配置即可运行）。"
    info "  · 想真实签到：编辑 .env，把 SMZDM_ADAPTER=mock 改为 real，并在网页里录入 Cookie。"
    info "  · 公网部署前：请把 REQUIRE_AUTH 改为 true，并设置强 ADMIN_PASSWORD / API_TOKEN。"
  else
    ok ".env 已存在，沿用现有配置"
  fi
}

# ---------- 6.5 源码确保（缺失时自动下载）----------
REPO_URL="${ZDC_REPO_URL:-https://github.com/125540947/zdmclock-clone-.git}"

source_present(){
  # 关键标记文件齐全即认为源码已就位
  [ -f docker-compose.yml ] && [ -f server/src/index.js ] && [ -d web/dist ]
}

download_source(){
  step "未检测到项目源码，准备自动下载"
  info "源码仓库：$REPO_URL"
  if ! has git; then
    err "未安装 git，无法自动下载源码。"
    err "请先安装 git（https://git-scm.com/）后重试，或手动 clone 仓库再运行本脚本。"
    return 1
  fi
  local target="zdmclock-clone"
  if [ -e "$target" ]; then
    err "当前目录已存在 '$target'，为避免覆盖已中止自动下载。"
    err "请在一个空目录运行本脚本，或手动 clone 后直接进入该目录运行。"
    return 1
  fi
  info "正在 git clone 源码到 ./$target ..."
  if ! git clone --depth 1 "$REPO_URL" "$target"; then
    err "源码下载失败。可能原因："
    err "  ① 该仓库为私有仓库，git 未配置凭据（请先登录 GitHub 或配置 SSH 密钥）；"
    err "  ② 网络不通或被墙；③ 仓库地址错误。"
    err "可用环境变量覆盖地址后重试：ZDC_REPO_URL=你的地址 ./deploy.sh"
    return 1
  fi
  if ! cd "$target"; then err "无法进入 $target 目录。"; return 1; fi
  ok "源码已下载到 ./$target 并已进入该目录"
  return 0
}

ensure_source(){
  if source_present; then
    ok "项目源码已就位（$(pwd)）"
    return 0
  fi
  warn "当前目录未包含项目源码，将尝试自动下载。"
  download_source || return 1
}

# ---------- 7. 健康检查 ----------
health_check(){
  local url="$1"
  step "等待服务就绪（最多约 60 秒）"
  READY=0
  for _ in $(seq 1 30); do
    if [ -n "$CURL_BIN" ] && curl -fsS "$url/api/health" >/dev/null 2>&1; then READY=1; break; fi
    if [ -n "$WGET_BIN" ] && wget -q -O /dev/null "$url/api/health" 2>/dev/null; then READY=1; break; fi
    sleep 2
  done
  if [ "$READY" -eq 1 ]; then ok "服务健康：$url"; else warn "未探测到健康检查响应，请查看日志或浏览器手动确认。"; fi
}

# ---------- 8. 两种部署路径 ----------
deploy_docker(){
  ensure_docker
  setup_env
  step "构建并启动容器（docker compose up -d --build）"
  if ! docker compose up -d --build; then
    err "启动失败，请运行 'docker compose logs' 查看详细错误。"
    exit 1
  fi
  health_check "http://localhost:3000"
}

deploy_node(){
  ensure_node
  setup_env
  # 原生模式需要前端构建产物（仓库已内置 web/dist）；缺失则提示
  if [ ! -d web/dist ]; then
    err "未找到 web/dist（前端构建产物）。原生模式需要它才能打开网页。"
    err "请改用 Docker 方式，或先运行：npm run build"
    exit 1
  fi
  step "安装 server 运行依赖（npm install --omit=dev）"
  ( cd server && npm install --omit=dev ) || { err "依赖安装失败。"; exit 1; }
  step "以生产模式后台启动服务"
  NODE_ENV=production PORT=3000 nohup node server/src/index.js > zdmclock.log 2>&1 &
  echo "$!" > zdmclock.pid
  info "服务已在后台启动（PID $(cat zdmclock.pid)），日志：zdmclock.log"
  health_check "http://localhost:3000"
}

# ---------- 主流程 ----------
main(){
  detect_os
  detect_tools
  detect_pkg
  # 确定是否需要 sudo（root 或非 root 无 sudo 时留空）
  if [ "$(id -u 2>/dev/null || echo 1000)" -eq 0 ]; then SUDO="";
  elif has sudo; then SUDO="sudo";
  else SUDO=""; fi

  print_report
  choose_mode

  # 源码就位检查：仅诊断模式在缺源码时可跳过；其余模式缺失则自动下载，下载失败即中止
  if [ "$MODE" != "diagnose" ] && ! source_present; then
    ensure_source || { err "缺少源码且无法自动下载，部署中止。"; exit 1; }
  fi

  case "$MODE" in
    diagnose)
      info "诊断完成。如需部署请重新运行并选择 1 或 2。"
      exit 0 ;;
    docker)
      deploy_docker ;;
    node)
      deploy_node ;;
  esac

  echo ""
  echo "${C_BOLD}部署完成！${C_RESET}"
  echo "  访问地址 : http://localhost:3000"
  if [ "$MODE" = "docker" ]; then
    echo "  查看日志 : docker compose logs -f"
    echo "  停止服务 : docker compose down"
  else
    echo "  查看日志 : tail -f zdmclock.log"
    echo "  停止服务 : kill \$(cat zdmclock.pid)"
  fi
  echo "  更新版本 : git pull && ./deploy.sh"
}

main "$@"
