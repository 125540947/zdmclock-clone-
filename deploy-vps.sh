#!/usr/bin/env bash
# 兼容层：统一转调 deploy.sh（唯一权威的部署逻辑所在）。
# deploy-vps.sh 与 deploy.sh 完全等价，两个文件名都能用；真正的逻辑只在 deploy.sh 维护一份，
# 避免重复维护导致再次分叉（历史上 deploy.sh 的"交互式/ /root"旧实现已彻底删除）。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/deploy.sh" ]; then
  exec bash "$SCRIPT_DIR/deploy.sh" "$@"
fi
echo "✗ 未找到同目录的 deploy.sh，请确认 deploy.sh 与本文件在一起。" >&2
exit 1
