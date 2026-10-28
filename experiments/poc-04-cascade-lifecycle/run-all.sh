#!/usr/bin/env bash
# PoC-04 全部读数一键复现。
#
# 前提：
#   - hikari-new 已 `npm run build`（脚本从 dist/ 取 validatePluginDefinition）
#   - DSH_ROOT 指向装了 @deepseek-ai/cordis@4.0.5 的目录
#       export DSH_ROOT='G:/work/LAB/code/_poc/poc01'
#   - Node v24.15.0
#
# 产物：cascade.json / race.json / event-final.json / partial-fail.json
# 本脚本只读：不改 src/、不改 test/、不改 DSH 与 Cordis 上游。

set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== C1–C3 级联 =="
node experiments/poc-04-cascade-lifecycle/cascade.mjs > /dev/null && echo "  cascade.json 已更新"

echo "== C4–C5 异步竞争与 PENDING 等待 =="
node experiments/poc-04-cascade-lifecycle/race.mjs > /dev/null && echo "  race.json 已更新"

echo "== A：Event 五项回归（最终适配层） =="
node experiments/poc-04-cascade-lifecycle/event-final.mjs | tail -9

echo "== B：部分初始化失败与 cleanup 抛错 =="
node experiments/poc-04-cascade-lifecycle/partial-fail.mjs | tail -3

echo "== PoC-03 契约层回归（确认本轮修复未破坏原判定） =="
for f in three-layers discipline rollback; do
  printf '  %-12s ' "$f"
  node "experiments/poc-03-contract-layer/$f.mjs" | tail -1
done

echo "== 零改动核对 =="
git diff --stat -- src test | tail -1
