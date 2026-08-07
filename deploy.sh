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
#   7. 公网探测   —— 尽力探测公网出口 IP；若可访问公网且为新生成 .env，自动加固（开鉴权+随机强密码/Token）
#   8. 安全清单   —— 部署完成末尾打印公网安全加固 checklist（防火墙/反代HTTPS/系统更新等）
#
# 用法： chmod +x deploy.sh && ./deploy.sh
#       也可单独下载本脚本后在空目录直接运行，它会自动拉取项目源码再部署
# ----------------------------------------------------------------------------

# ----------------------------------------------------------------------------
# 2026-08-07 起：deploy.sh 改为 deploy-vps.sh 的薄包装，避免旧交互式脚本卡在
# `read` 提示、且 APP_DIR 被错解析成 /root。真正的部署逻辑都在 deploy-vps.sh。
# ----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/deploy-vps.sh" ]; then
  echo "==> deploy.sh -> 转调 deploy-vps.sh（已修复旧版交互卡死 / /root 解析问题）"
  exec bash "$SCRIPT_DIR/deploy-vps.sh" "$@"
fi

# 兼容：若 deploy-vps.sh 不存在，回落到原始交互式逻辑（旧行为）
# 不用 set -e：交互输入、网络探测、自动安装都可能返回非 0，需手动判断，避免误退出
set -uo pipefail

DOCKER_SUDO=""   # 当前用户无 docker 守护进程权限时，用 sudo 前缀执行 docker 命令
ENV_NEW=0         # setup_env 新建 .env 时置 1，供公网自动加固判断是否覆盖默认值
IS_PUBLIC=0       # 探测到可访问公网时置 1
PUBLIC_IP="未检测"
SEDI="sed -i"     # 跨平台 sed -i：macOS/BSD 需 "sed -i ''"，在 main 中按 OS 修正

# 生成一个随机强值（多级兜底，保证永不返回空串）
gen_secret(){
  if has openssl; then openssl rand -hex 24 && return 0; fi
  if has base64; then head -c 18 /dev/urandom 2>/dev/null | base64 | tr -dc 'A-Za-z0-9' | head -c 36 && return 0; fi
  if has od; then head -c 18 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n' | head -c 48 && return 0; fi
  # 最后兜底：时间 + 随机数（仍保留足够熵，避免空值）
  printf '%s%s' "$(date +%s%N 2>/dev/null || date +%s)" "$RANDOM" | tr -dc 'A-Za-z0-9' | head -c 36
}

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

# ---------- 2.5 探测公网出口 IP（尽力而为，失败不影响部署）----------
detect_public(){
  IS_PUBLIC=0; PUBLIC_IP="未检测"
  local ip=""
  if has curl; then
    ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  elif has wget; then
    ip="$(wget -q -O - --timeout=5 https://api.ipify.org 2>/dev/null || true)"
  fi
  if [ -n "$ip" ]; then
    IS_PUBLIC=1; PUBLIC_IP="$ip"
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
  if [ "$IS_PUBLIC" = "1" ]; then
    echo "  公网 IP  : $PUBLIC_IP（可访问公网，若对外提供服务请做安全加固）"
  else
    echo "  公网 IP  : 未检测到（内网/离线环境，默认配置即可）"
  fi
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
  # 关键：docker compose version 不连接守护进程，会漏判权限问题；
  # 必须用 docker info 确认当前用户真能连上守护进程（unix:///var/run/docker.sock）。
  if docker info >/dev/null 2>&1; then
    DOCKER_SUDO=""
    ok "Docker 环境就绪（compose $COMPOSE_VER）"
  elif [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then
    DOCKER_SUDO="$SUDO"
    warn "当前用户不在 docker 组，后续 Docker 命令将自动加 sudo 执行。"
    info "（想永久免 sudo：执行 sudo usermod -aG docker \$USER 后【注销重登录】再跑本脚本）"
  else
    err "无法连接 Docker 守护进程（permission denied）。"
    err "请执行：sudo usermod -aG docker \$USER，然后【注销并重新登录】终端，再重新运行 ./deploy.sh"
    err "（或改用 root 运行；当前既非 root 也无 sudo 权限时无法继续）"
    exit 1
  fi
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
    ENV_NEW=1
    info "已根据 .env.example 生成 .env（默认演示模式 mock，本地零配置即可运行）。"
    info "  · 想真实签到：编辑 .env，把 SMZDM_ADAPTER=mock 改为 real，并在网页里录入 Cookie。"
    # 公网环境自动加固：避免默认弱口令（admin123）+ 关闭鉴权 暴露在公网被任意访问
    if [ "$IS_PUBLIC" = "1" ]; then
      harden_env
    else
      info "  · 公网部署前：请把 REQUIRE_AUTH 改为 true，并设置强 ADMIN_PASSWORD / API_TOKEN。"
    fi
  else
    ENV_NEW=0
    ok ".env 已存在，沿用现有配置"
  fi
}

# 公网自动加固：开启鉴权 + 写入随机强密码与 API Token（仅作用于新生成的 .env）
harden_env(){
  local pw apitok ts
  pw="$(gen_secret)"; apitok="$(gen_secret)"; ts="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo unknown)"
  $SEDI "s#^REQUIRE_AUTH=.*#REQUIRE_AUTH=true#" .env
  $SEDI "s#^ADMIN_PASSWORD=.*#ADMIN_PASSWORD=$pw#" .env
  $SEDI "s#^API_TOKEN=.*#API_TOKEN=$apitok#" .env
  ok "检测到公网环境，已自动加固 .env：REQUIRE_AUTH=true，ADMIN_PASSWORD 与 API_TOKEN 已设为随机强值。"
  warn "后台管理员密码已设为：$pw（请妥善保存；忘记可删 .env 后重跑本脚本重新生成）"
  warn "API_TOKEN=$apitok（仅前端/接口调用需要时使用，非登录密码）"
  # 同时写入本地备份文件（chmod 600），防止终端输出滚过去看不见；含密钥，已被 .gitignore / .dockerignore 排除
  {
    echo "# 本文件由 deploy.sh 自动生成，保存了本次加固写入 .env 的随机强凭证。"
    echo "# 请勿提交 / 分享本文件（含管理员密码与 API Token）。"
    echo "# 忘记凭证时，可删掉 .env 与 .env.generated，重跑 ./deploy.sh 重新生成。"
    echo "ADMIN_PASSWORD=$pw"
    echo "API_TOKEN=$apitok"
    echo "# 生成时间: $ts"
  } > .env.generated
  chmod 600 .env.generated 2>/dev/null
  info "凭证备份已写入 .env.generated（权限 600，仅本机可读；请同样妥善保存）。"
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
  step "构建并启动容器（${DOCKER_SUDO}docker compose up -d --build）"
  if ! $DOCKER_SUDO docker compose up -d --build; then
    err "启动失败，请运行 '${DOCKER_SUDO}docker compose logs' 查看详细错误。"
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

# ---------- 8.5 末尾安全加固清单 ----------
print_security_checklist(){
  echo ""
  echo "${C_BOLD}安全加固清单${C_RESET}"
  if [ "$IS_PUBLIC" = "1" ]; then
    echo "  检测到本机可访问公网（出口 IP $PUBLIC_IP），若对外提供服务请务必："
    if [ "$ENV_NEW" = "1" ]; then
      echo "    ${C_GREEN}✓${C_RESET} 已自动开启鉴权，并生成强 ADMIN_PASSWORD / API_TOKEN（见上方提示）"
    else
      echo "    ${C_YELLOW}□${C_RESET} 确认 .env 中 REQUIRE_AUTH=true，且 ADMIN_PASSWORD / API_TOKEN 为强值"
    fi
    echo "    ${C_YELLOW}□${C_RESET} 防火墙只开必要端口："
    echo "        sudo ufw allow 22/tcp && sudo ufw allow 3000/tcp && sudo ufw enable"
    echo "    ${C_YELLOW}□${C_RESET} 建议用 nginx/Caddy + 免费 HTTPS 反代，隐藏裸端口 3000（明文 HTTP 易泄露凭证）"
    echo "    ${C_YELLOW}□${C_RESET} 定期更新系统：sudo apt update && sudo apt -y upgrade"
  else
    echo "  当前为本地/内网环境，保持默认即可；一旦放到公网，请先做上述加固。"
  fi
  echo "    ${C_YELLOW}□${C_RESET} 切勿把 .env、server/data* 提交/备份/共享（含真实 smzdm Cookie 凭证）"
}

# ---------- 主流程 ----------
main(){
  detect_os
  detect_tools
  detect_pkg
  # macOS/BSD 的 sed -i 需要空参数，提前适配
  case "$OS_TYPE" in
    macOS|*BSD*) SEDI="sed -i ''" ;;
    *) SEDI="sed -i" ;;
  esac
  # 确定是否需要 sudo（root 或非 root 无 sudo 时留空）
  if [ "$(id -u 2>/dev/null || echo 1000)" -eq 0 ]; then SUDO="";
  elif has sudo; then SUDO="sudo";
  else SUDO=""; fi

  detect_public
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
    echo "  查看日志 : ${DOCKER_SUDO}docker compose logs -f"
    echo "  停止服务 : ${DOCKER_SUDO}docker compose down"
  else
    echo "  查看日志 : tail -f zdmclock.log"
    echo "  停止服务 : kill \$(cat zdmclock.pid)"
  fi
  echo "  更新版本 : git pull && ./deploy.sh"
  print_security_checklist
}

main "$@"
