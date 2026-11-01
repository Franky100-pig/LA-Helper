#!/usr/bin/env bash
# 一键跑 ci.yml 的全部检查 —— 本地发版/收尾前必跑。
#
# 背景（2026-10-31，CI 连红 3 次的教训）：收尾只跑「自以为相关」的几条守卫，
# 漏掉的 test_onboarding.js 带着裸 location 的回归上了 main。本地验收必须
# 与 CI 完全同清单，这个脚本就是把 ci.yml 抄成一条命令。
#
# 用法：
#   bash tools/check_all.sh              # 全部
#   bash tools/check_all.sh --fast       # 跳过 pytest（改前端时用，CI 仍会跑）
#
# 退出码：任一步失败立即非零退出，并指明是哪条。
set -uo pipefail
cd "$(dirname "$0")/.."

NODE=${NODE:-node}
PY=${PY:-python}
FAIL=0
CURRENT=""

run() {
  CURRENT="$1"
  shift
  if "$@" >/tmp/check_all_last.log 2>&1; then
    echo "✓ $CURRENT"
  else
    echo "✗ $CURRENT  （输出见下）"
    tail -30 /tmp/check_all_last.log
    FAIL=1
  fi
}

echo "== pytest（core + desktop）=="
if [ "${1:-}" = "--fast" ]; then
  echo "– 跳过（--fast）"
else
  run "pytest" "$PY" -m pytest tests/ -q --basetemp="$(mktemp -d /tmp/la-pytest-XXXXXX)"
fi

echo "== JS 守卫（与 ci.yml 同序）=="
for s in check_i18n check_no_hardcoded_zh test_no_hardcoded_zh test_notes \
         test_counter test_export test_onboarding test_step_player \
         test_bridge_fallback test_ai_key; do
  run "$s.js" "$NODE" "tools/$s.js"
done

echo "== Python 引擎检查 =="
run "test_examples.py"   "$PY" tools/test_examples.py
run "check_core_i18n.py" "$PY" tools/check_core_i18n.py
run "test_core_i18n.py"  "$PY" tools/test_core_i18n.py

echo "== 冒烟测试（本地起服务，POST /api/compute）=="
"$PY" web/app.py --no-browser --port 8123 >/tmp/check_all_server.log 2>&1 &
SRV=$!
sleep 3
if curl -sS -m 10 -X POST http://127.0.0.1:8123/api/compute \
     -H 'Content-Type: application/json' \
     -d '{"op":"det","A":[["1","2"],["3","4"]]}' | grep -q '"ok": *true'; then
  echo "✓ 冒烟：/api/compute 返回 ok"
else
  echo "✗ 冒烟：请求失败（服务日志见 /tmp/check_all_server.log）"
  FAIL=1
fi
kill "$SRV" 2>/dev/null || true

echo
if [ "$FAIL" -eq 0 ]; then
  echo "全部通过 ✓ —— 与 ci.yml 同清单"
else
  echo "有失败项 ✗ —— 修完再提交/发版"
fi
exit "$FAIL"
