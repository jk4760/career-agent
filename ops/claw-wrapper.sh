#!/usr/bin/env bash
# claw-wrapper.sh — Kimi Claw 专用受限 SSH 入口
# 仅允许白名单两条命令；剥离 SSH_ORIGINAL_COMMAND 首尾引号后精确匹配，其余一律拒绝。
set -euo pipefail

raw="${SSH_ORIGINAL_COMMAND:-}"
cmd="${raw%\"}"; cmd="${cmd#\"}"
cmd="$(printf '%s' "$cmd" | sed -e 's/^ *//' -e 's/ *$//')"

case "$cmd" in
  "/opt/nextcareer/ops/daily.sh collect-and-push")
    exec /opt/nextcareer/ops/daily.sh collect-and-push
    ;;
  "/opt/nextcareer/ops/daily.sh push-only")
    exec /opt/nextcareer/ops/daily.sh push-only
    ;;
  *)
    echo "REJECTED by claw-wrapper: '$raw' 不在白名单" >&2
    exit 1
    ;;
esac
