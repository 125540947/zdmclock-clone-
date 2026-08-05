#!/usr/bin/env bash
# zdmclock-clone 一键 Docker 部署脚本
# 用法：chmod +x deploy.sh && ./deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "==> [1/4] 检查 Docker 与 Compose ..."
if ! command -v docker >/dev/null 2>&1; then
  echo "错误：未检测到 docker，请先安装 https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "错误：docker compose（V2）不可用，请升级 Docker 到较新版本。"
  exit 1
fi

echo "==> [2/4] 初始化 .env ..."
if [ ! -f .env ]; then
  if [ ! -f .env.example ]; then
    echo "错误：缺少 .env.example，无法生成 .env"
    exit 1
  fi
  cp .env.example .env
  echo "    已根据 .env.example 生成 .env（默认 REQUIRE_AUTH=false, ADMIN_PASSWORD=admin123）。"
  echo "    [安全] 若公网暴露，请编辑 .env：REQUIRE_AUTH=true 并修改 ADMIN_PASSWORD / API_TOKEN 为强值。"
fi

echo "==> [3/4] 构建并启动容器 ..."
docker compose up -d --build

echo "==> [4/4] 等待服务就绪 ..."
READY=0
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "    服务健康：/api/health 返回 ok"
    READY=1
    break
  fi
  sleep 2
done
[ "$READY" -eq 0 ] && echo "    警告：30 次探测仍未就绪，请运行 'docker compose logs' 排查。"

echo ""
echo "部署完成！"
echo "  访问地址 : http://localhost:3000"
echo "  查看日志 : docker compose logs -f"
echo "  停止服务 : docker compose down"
echo "  更新版本 : git pull && ./deploy.sh"
