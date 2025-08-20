# MUI Public Repository

MUI Public is a monorepo containing public packages and applications for the MUI ecosystem. This repository uses pnpm workspaces and includes various build tools, Babel plugins, bundle analyzers, and web applications built with React/Vite and Toolpad Studio.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap, Build, and Test the Repository
- **Prerequisites**: Node.js 18+ required. Install pnpm: `npm install -g pnpm@10.14.0`
- **Install dependencies**: `pnpm install --no-frozen-lockfile` -- takes 15-20 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
  - **Known Issue**: The `test/bundle-size` package has a dependency on `pkg.pr.new` that may fail due to network issues. If install fails, temporarily remove the `@base-ui-components/react` dependency from `test/bundle-size/package.json` and rerun.
- **Build all packages**: `pnpm release:build` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Type checking**: `pnpm typescript` -- takes 10-15 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Linting**: `pnpm eslint` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Run tests**: `pnpm test` -- takes 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.

### Run Applications
- **Code Infra Dashboard** (React/Vite app):
  - **ALWAYS run the bootstrapping steps first**
  - Build: `cd apps/code-infra-dashboard && pnpm run build` -- takes 5 seconds
  - Dev server: `cd apps/code-infra-dashboard && pnpm run start` -- runs on http://localhost:3000
- **Tools Public** (Toolpad Studio app):
  - **ALWAYS run the bootstrapping steps first**
  - Dev server: `cd apps/tools-public && pnpm run dev` -- runs on http://localhost:3005
  - **Note**: Requires `GITHUB_TOKEN` and `ZENDESK` environment variables for full functionality

## Validation

- **ALWAYS manually validate any new code** by running the complete build process after making changes.
- **ALWAYS run through at least one complete end-to-end scenario** after making changes:
  1. Install dependencies and build all packages
  2. Run tests to ensure no regressions
  3. Start one of the applications and verify it loads correctly
  4. Test CLI functionality with `pnpm code-infra --help`
- You can build and run both web applications, and interact with them via browser or programmatically.
- **ALWAYS run `pnpm eslint` and `pnpm typescript` before you are done** or the CI will fail.

## Common Tasks

### pnpm Workspace Commands
- **CRITICAL**: When running pnpm commands for workspace packages, always use the `-F` flag followed by the package name.
- **Example**: `pnpm -F @mui/internal-bundle-size-checker add micromatch`
- **Do NOT use `cd` to navigate into package directories** for workspace operations.

### Repository Structure
```
packages/
├── babel-plugin-display-name/     # Babel plugin for component display names
├── babel-plugin-minify-errors/    # Babel plugin for error minification
├── babel-plugin-resolve-imports/  # Babel plugin for import resolution
├── bundle-size-checker/           # Bundle size analysis tool
├── code-infra/                   # Build scripts and configs
└── docs-infra/                   # Documentation infrastructure

apps/
├── code-infra-dashboard/         # React/Vite dashboard app
└── tools-public/                 # Toolpad Studio internal tools

test/
└── bundle-size/                  # Bundle size test workspace
```

### Key CLI Commands
- `pnpm code-infra --help` -- Show available CLI commands
- `pnpm code-infra build` -- Build a specific package
- `pnpm code-infra list-workspaces` -- List all workspace packages
- `pnpm code-infra publish` -- Publish packages to npm
- `pnpm code-infra publish-canary` -- Publish canary versions

### Build and Release Process
- **Version packages**: `pnpm release:version` (uses lerna)
- **Build packages**: `pnpm release:build` -- builds all packages in `/packages/*`
- **Bundle size check**: `pnpm size:snapshot` -- **Note**: May fail due to missing pkg.pr.new dependency

## Troubleshooting

### Common Issues and Workarounds

#### pnpm install fails with pkg.pr.new error
```bash
# Temporarily edit test/bundle-size/package.json to remove the problematic dependency:
# Remove: "@base-ui-components/react": "https://pkg.pr.new/@base-ui-components/react@e4647f7"
# Then run: pnpm install --no-frozen-lockfile
```

#### Bundle size check fails
```bash
# This is expected if the pkg.pr.new dependency was removed
# The bundle size check will fail but other functionality works normally
```

#### Peer dependency warnings
```bash
# React version mismatches are expected and do not affect functionality
# The repository uses React 19 but some dependencies expect React 18
```

## Frequently Referenced Files and Locations

### Configuration Files
- `package.json` -- Root package configuration and scripts
- `pnpm-workspace.yaml` -- Workspace configuration
- `eslint.config.mjs` -- ESLint configuration
- `tsconfig.json` -- Root TypeScript configuration
- `vitest.config.mts` -- Vitest test configuration

### Build and CI
- `.github/workflows/ci-base.yml` -- Main CI workflow
- `.github/workflows/publish.yml` -- Package publishing workflow
- `lerna.json` -- Lerna configuration for versioning

### Development
- `CLAUDE.md` -- Special instructions for AI assistants
- `README.md` -- Main repository documentation

## Expected Timing and Never-Cancel Warnings

- **pnpm install**: 15-20 seconds under normal conditions. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm release:build**: 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm typescript**: 10-15 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm eslint**: 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **pnpm test**: 5-10 seconds. **NEVER CANCEL**. Set timeout to 30+ minutes.
- **Application builds**: 3-5 seconds each. **NEVER CANCEL**. Set timeout to 15+ minutes.

All commands are fast in this repository, but network issues or system load can cause delays. Always wait for completion.