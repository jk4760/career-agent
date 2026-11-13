#!/usr/bin/env bash
# M4 验收 §3.6-12/13/15 造数自测（本机，preview 接口不真发飞书）
# 造数标记：push_log.channel='feishu-test'、feedback.comment='TEST_FABRICATED'，结束全清理
set -uo pipefail
cd "$(dirname "$0")/.."
PSQL() { docker compose exec -T db psql -U "${DB_USER:-nextcareer}" "${DB_NAME:-nextcareer}" -tAc "$1" </dev/null; }
PREVIEW() { curl -s -m 30 -X POST http://127.0.0.1:3001/internal/push/preview; }

echo "=== T0 基线：push_log 应为空（上次无 webhook 推送失败没写入）==="
PSQL "SELECT count(*) FROM push_log;"
PREVIEW | python3 -c "
import json,sys
c = json.load(sys.stdin)
print(f'候选 {len(c)} 条（应 ≤15），全部 kind=new: {all(x[\"kind\"]==\"new\" for x in c)}，全部 final≥60: {all(x[\"final\"]>=60 for x in c)}')
ids = [x['id'] for x in c]
open('/tmp/m4_test_ids.txt','w').write('\n'.join(ids) + '\n')
"

echo "=== T1 顺延补发：把 15 条候选标记为今早已推（channel=feishu-test）==="
while read -r id; do
  [ -n "$id" ] && PSQL "INSERT INTO push_log (job_id, channel) VALUES ('$id', 'feishu-test');" >/dev/null
done < /tmp/m4_test_ids.txt
PREVIEW | python3 -c "
import json,sys
c = json.load(sys.stdin)
old = set(open('/tmp/m4_test_ids.txt').read().split())
overlap = [x for x in c if x['id'] in old]
print(f'新一批候选 {len(c)} 条，与上午批次重叠 {len(overlap)} 条（应为 0=顺延池生效）')
print('前 3 条:', [(x['company'], x['title'][:18], x['final']) for x in c[:3]])
"

echo "=== T2 无反馈满 5 天重推：把造的 push_log 时间回拨 6 天 ==="
PSQL "UPDATE push_log SET pushed_at = now() - interval '6 days' WHERE channel='feishu-test';"
PREVIEW | python3 -c "
import json,sys
c = json.load(sys.stdin)
repush = [x for x in c if x['kind']=='repush']
print(f'候选 {len(c)} 条，其中 repush {len(repush)} 条（应 15 条全回来）')
"

echo "=== T3 不合适排除：给其中 1 条造 pass 反馈 ==="
ID1=$(head -1 /tmp/m4_test_ids.txt)
PSQL "INSERT INTO feedback_events (job_id, action, reason, comment) VALUES ('$ID1', 'pass', '职能', 'TEST_FABRICATED');"
PREVIEW | python3 -c "
import json,sys
c = json.load(sys.stdin)
target = open('/tmp/m4_test_ids.txt').read().split()[0]
present = any(x['id']==target for x in c)
print(f'被 pass 的岗位仍在候选: {present}（应 False）')
"

echo "=== T4 生命周期 2 次：给另 1 条造第二次推送记录 ==="
ID2=$(sed -n 2p /tmp/m4_test_ids.txt)
PSQL "INSERT INTO push_log (job_id, channel) VALUES ('$ID2', 'feishu-test');"
PREVIEW | python3 -c "
import json,sys
c = json.load(sys.stdin)
target = open('/tmp/m4_test_ids.txt').read().split()[1]
present = any(x['id']==target for x in c)
repush = [x for x in c if x['kind']=='repush']
print(f'已推满 2 次的岗位仍在候选: {present}（应 False）；repush 剩 {len(repush)} 条（应 13）')
"

echo "=== T5 清理造数 ==="
PSQL "DELETE FROM push_log WHERE channel='feishu-test';"
PSQL "DELETE FROM feedback_events WHERE comment='TEST_FABRICATED';"
PSQL "SELECT 'push_log 剩 ' || count(*) || ' 条' FROM push_log;"
echo "=== 自测结束 ==="
