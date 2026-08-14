#!/usr/bin/env bash

set -euo pipefail

cat > /dev/null
max="$CLAUDE_MAX_TURNS"
soft=$((max * 4 / 5))
counter_file="${RUNNER_TEMP:?RUNNER_TEMP must be set}/claude-agent-turn-count"
turns=$(($(cat "$counter_file" 2>/dev/null || echo 0) + 1))
printf '%s' "$turns" > "$counter_file"
message="[TURN BUDGET] ${turns}/${max} turns used; return your result by turn ${soft}."
printf '{"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":"%s"}}\n' "$message"
