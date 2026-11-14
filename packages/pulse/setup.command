#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

FORCE_ONLINE=0
HAS_OFFLINE=0
FORWARD_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --online)
      FORCE_ONLINE=1
      ;;
    --offline|-Offline)
      HAS_OFFLINE=1
      FORWARD_ARGS+=("$arg")
      ;;
    *)
      FORWARD_ARGS+=("$arg")
      ;;
  esac
done

set +e
if [ "$FORCE_ONLINE" -eq 0 ] && [ "$HAS_OFFLINE" -eq 0 ] && \
   [ -f "./install-context-capsule.js" ] && [ -f "./context-capsule-payload.js" ]; then
  bash ./setup.sh --offline ${FORWARD_ARGS[@]+"${FORWARD_ARGS[@]}"}
  rc=$?
else
  bash ./setup.sh ${FORWARD_ARGS[@]+"${FORWARD_ARGS[@]}"}
  rc=$?
fi
set -e

if [ -t 0 ]; then
  echo ""
  echo "Done (exit code: $rc). Closing in 5s, or press any key to close..."
  echo "执行完成（退出码：$rc）。5 秒后自动关闭，或按任意键关闭..."
  read -r -n 1 -t 5 _ || true
fi

exit "$rc"
