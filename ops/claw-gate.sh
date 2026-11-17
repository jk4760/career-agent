#!/usr/bin/env bash
# Claw 专用 SSH 闸门（M4 §3.5 触发层）
# authorized_keys 里 command= 强制指向本脚本：无论客户端发什么命令，
# 只按白名单放行 daily.sh 的三个子命令，其余一律拒绝（最小爆炸半径）。
set -euo pipefail

case "${SSH_ORIGINAL_COMMAND:-}" in
  "daily.sh collect-and-push" | "/opt/nextcareer/ops/daily.sh collect-and-push")
    exec /opt/nextcareer/ops/daily.sh collect-and-push
    ;;
  "daily.sh push-only" | "/opt/nextcareer/ops/daily.sh push-only")
    exec /opt/nextcareer/ops/daily.sh push-only
    ;;
  "daily.sh status" | "/opt/nextcareer/ops/daily.sh status")
    exec /opt/nextcareer/ops/daily.sh status
    ;;
  *)
    echo "claw-gate: 拒绝执行：${SSH_ORIGINAL_COMMAND:-<空命令>}" >&2
    exit 1
    ;;
esac
