# Flake-fix sandbox payload

These are the standalone scripts that `.github/workflows/claude-flake-fix.yml` runs to triage
CircleCI flakiness with a fully autonomous Claude agent. They live here — tested, readable — and
are **inlined into the workflow as base64** so a repo pinning that workflow by SHA gets the exact
code that will run, with no second checkout at a moving ref.

## Files

| File                | Runs in             | Role                                                             |
| :------------------ | :------------------ | :--------------------------------------------------------------- |
| `fetch.mjs`         | trusted host step   | Downloads recent CircleCI failure logs; holds the CircleCI token |
| `proxy.mjs`         | sidecar container   | Mints + exchanges the Anthropic WIF token, injects it upstream   |
| `bootstrap.sh`      | agent container     | Installs the pinned CLI, runs the agent, captures its diff       |
| `prompt.txt`        | agent container     | The triage + fix instructions the agent follows                  |
| `inspect-patch.mjs` | trusted publish job | Vets the agent's patch before it is applied and pushed           |
| `generate.mjs`      | dev / CI            | Syncs the base64 blobs in the workflow with these files          |

## Editing

Edit the file here, then regenerate the inlined copies:

```bash
node .github/sandbox/generate.mjs
```

`node .github/sandbox/generate.mjs --check` fails if the workflow is out of sync — wire it into CI
so a hand-edit here that skips regeneration cannot merge. **Do not hand-edit the base64 blobs in
the workflow.**

## Tests

```bash
node --test .github/sandbox/*.test.mjs
```

They are `node:test` (not vitest) on purpose: these scripts must run under plain `node` in a
dependency-free container, and their tests share that constraint — no dev dependencies, no build.
The proxy and patch-guard tests are the security-relevant ones; keep them green.

> TODO: wire `node --test .github/sandbox/*.test.mjs` and `generate.mjs --check` into CI, and pin
> the `node:22-alpine` / `node:22-bookworm` images by digest in the workflow.

## Why a sidecar and a separate publish job

The agent runs `--dangerously-skip-permissions`, so the security model is not the tool allowlist —
it is that **nothing secret is in the container**. The Anthropic token lives only in the sidecar
(`proxy.mjs`), the CircleCI token is spent by `fetch.mjs` before any container starts, and the
GitHub write token exists only in the downstream `publish` job, which trusts nothing from the
sandbox except a patch it re-checks (`inspect-patch.mjs`). See the workflow header for the full
threat model and the two caller-setup traps.
