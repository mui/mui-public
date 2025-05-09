# Claude Instructions

## pnpm Workspace Commands

- When running pnpm commands for workspace packages, always use the `-F` flag followed by the package name
- Example: `pnpm -F @mui/internal-bundle-size-checker add micromatch`
- Do NOT use `cd` to navigate into the package directory

## Commands to Run After Code Changes

- TBD (Add linting or typecheck commands here when identified)