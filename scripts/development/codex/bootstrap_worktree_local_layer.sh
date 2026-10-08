#!/usr/bin/env bash
set -euo pipefail
usage() { echo "Usage: $0 [--refresh-managed] <TARGET_WORKTREE>" >&2; }
REFRESH=0
if [[ "${1:-}" == "--refresh-managed" ]]; then
  REFRESH=1
  shift
fi
[[ $# -eq 1 ]] || { usage; exit 2; }
TARGET="$1"
ARGS=(worktree bootstrap --worktree "$TARGET")
[[ "$REFRESH" -eq 1 ]] && ARGS+=(--refresh-managed)
exec ai-dev "${ARGS[@]}"
