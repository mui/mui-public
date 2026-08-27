#!/usr/bin/env bash
# Entrypoint of the sandboxed agent container.
#
# The container is the security boundary: no credential is present. ANTHROPIC_BASE_URL points at
# the sidecar, which is the only thing that holds a token — the placeholder ANTHROPIC_API_KEY the
# CLI sends is stripped and replaced there. /work is the caller's checkout (the tree to edit),
# /data holds the pre-fetched CircleCI logs (read-only), /out collects the outputs.
#
# The agent never runs git or opens anything; it classifies, edits files, and writes report/PR
# text. This script deterministically captures whatever it changed as a patch for the publish job.
set -euo pipefail

: "${MODEL:?MODEL is required}"
: "${CLAUDE_CLI_VERSION:?pin the CLI version}"

# The container runs as a non-root uid (to match the mounted checkout's ownership, and because
# the CLI refuses --dangerously-skip-permissions as root). So global npm and the CLI's own state
# need a writable HOME and prefix rather than /usr/local and /root.
export HOME="${HOME:-/tmp/agent-home}"
mkdir -p "$HOME/.npm-global"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$PATH"
npm install -g "@anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}" >/dev/null 2>&1

# git only reads here (to diff the agent's edits); mark the mounted tree safe for this throwaway
# container so the CLI's own git-aware features and the diff below work.
git config --global --add safe.directory /work

# stream-json to a log the workflow uploads as an artifact — the only way to see, after the fact,
# what the unrestricted agent actually did and which tools it used.
prompt="$(cat /out/prompt.txt)"
set +e
claude --print "${prompt}" \
  --bare \
  --dangerously-skip-permissions \
  --model "${MODEL}" \
  --output-format stream-json --verbose \
  | tee /out/execution.json
agent_status=${PIPESTATUS[0]}
set -e
echo "agent exit status: ${agent_status}"

# Capture the agent's edits as a patch against the checkout. Staging is throwaway (the container
# is discarded); `--binary` and `add -A` make the patch complete, including any new files. The
# publish job inspects and applies this to a fresh checkout — the agent's tree is never trusted.
git -C /work add -A
git -C /work diff --cached --binary > /out/fix.patch || true
echo "captured $(wc -l < /out/fix.patch) lines of patch"
