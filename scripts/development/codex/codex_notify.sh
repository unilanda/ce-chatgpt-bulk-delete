#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="$(basename "$ROOT")"
TITLE="Codex — ${NAME}"
BODY="Turn finished or Codex needs attention."

if command -v notify-send >/dev/null 2>&1; then
    notify-send "$TITLE" "$BODY" >/dev/null 2>&1 || true
fi

if command -v paplay >/dev/null 2>&1; then
    SOUND="/usr/share/sounds/freedesktop/stereo/complete.oga"
    [[ -f "$SOUND" ]] && paplay "$SOUND" >/dev/null 2>&1 || true
elif command -v canberra-gtk-play >/dev/null 2>&1; then
    canberra-gtk-play -i complete >/dev/null 2>&1 || true
else
    printf '\a' >/dev/tty 2>/dev/null || true
fi

exit 0
