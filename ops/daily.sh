#!/usr/bin/env bash
# NextCareer M4 编排唯一入口（§3.5 执行层）
#   daily.sh collect-and-push   早 8:30：采集 → 评分 → 推送
#   daily.sh push-only          晚 17:30：只推不采
#   daily.sh status             只读巡检：最近一次采集/评分/推送状态
# flock 防重入；日志落盘 ops/logs/ops-YYYYMMDD.log；失败非零退出 + 同群 ⚠️ 告警
set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$OPS_DIR")"
LOG_DIR="$OPS_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/ops-$(date +%Y%m%d).log"
LOCK_FILE="$OPS_DIR/.daily.lock"
API="http://127.0.0.1:3001"  # api 仅绑定 loopback（compose 内网 + 宿主机本地，公网不可见）

log() { echo "[$(date '+%F %T')] $*" >>"$LOG_FILE"; }

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

alert() {
  # ⚠️ 同群告警；告警本身失败不阻塞（webhook 挂了由 17:30 静默暴露）
  curl -s -m 15 -X POST "$API/internal/alert" \
    -H 'Content-Type: application/json' \
    -d "{\"text\": $(json_str "$1")}" >/dev/null 2>&1 || true
}

die() {
  log "FAIL: $1"
  alert "$1"
  exit 1
}

psql_q() {
  docker compose -f "$ROOT_DIR/docker-compose.yml" --env-file "$ROOT_DIR/.env" \
    exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -tAc "$1"' _ "$1"
}

cmd_collect_and_push() {
  log "== collect-and-push 开始 =="
  cd "$ROOT_DIR"
  if ! docker compose --profile manual run --rm -T collector >>"$LOG_FILE" 2>&1; then
    die "采集器运行失败（详见当日 ops 日志末尾）"
  fi
  log "采集完成，开始评分（同步，推送前必须就绪）"
  local score_resp
  if ! score_resp=$(curl -fsS -m 1800 -X POST "$API/internal/score" \
      -H 'Content-Type: application/json' -d '{}'); then
    die "评分接口调用失败（推送中止，岗位按规则分留待下轮）"
  fi
  log "评分完成：$score_resp"
  local push_resp
  if ! push_resp=$(curl -fsS -m 60 -X POST "$API/internal/push" \
      -H 'Content-Type: application/json' -d '{"mode":"collect-and-push"}'); then
    die "推送接口调用失败"
  fi
  log "推送完成：$push_resp"
  log "== collect-and-push 结束（成功）=="
}

cmd_push_only() {
  log "== push-only 开始 =="
  local push_resp
  if ! push_resp=$(curl -fsS -m 60 -X POST "$API/internal/push" \
      -H 'Content-Type: application/json' -d '{"mode":"push-only"}'); then
    die "推送接口调用失败"
  fi
  log "推送完成：$push_resp"
  log "== push-only 结束（成功）=="
}

cmd_status() {
  echo "== NextCareer ops status（只读）=="
  echo "-- 采集（jobs 表）--"
  psql_q "SELECT '总数 ' || count(*) || '，最新入库 ' || COALESCE(max(collected_at)::text, '无') FROM jobs;"
  psql_q "SELECT source || ': ' || count(*) FROM jobs GROUP BY source ORDER BY count(*) DESC;"
  echo "-- LLM 评分 --"
  curl -s -m 10 "$API/internal/score/status" || echo "（api 不可达）"
  echo
  psql_q "SELECT '已评分 ' || count(*) || ' / 总数 ' || (SELECT count(*) FROM jobs) FROM jobs WHERE llm_eval IS NOT NULL;"
  echo "-- 推送（push_log）--"
  psql_q "SELECT '今日已推 ' || count(*) || ' 条' FROM push_log WHERE pushed_at::date = current_date;"
  psql_q "SELECT '最近一次推送 ' || max(pushed_at)::text FROM push_log;"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    collect-and-push|push-only)
      exec 9>"$LOCK_FILE"
      if command -v flock >/dev/null 2>&1; then
        if ! flock -n 9; then
          log "另一个 $cmd 正在运行，本次跳过（flock 防重入）"
          exit 0
        fi
      else
        log "警告：系统无 flock（非生产环境？），跳过重入保护"
      fi
      "cmd_${cmd//-/_}"
      ;;
    status)
      cmd_status
      ;;
    *)
      echo "用法: $0 {collect-and-push|push-only|status}" >&2
      exit 64
      ;;
  esac
}

main "$@"
