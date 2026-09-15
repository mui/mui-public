// Thin wrapper that runs the `@mui/internal-benchmark` CLI from the workspace package's build
// output. Importing the package by name (rather than relying on its `benchmark` bin) avoids
// depending on pnpm linking the bin shim: the package publishes from `build/`, so the workspace
// link points at a directory that does not exist until the first build — and a later build cannot
// create a shim that install already skipped. The same wrapper exists in `docs/scripts` for the
// same reason.
//
// A consumer installing the published package gets a self-contained directory and can use the bin
// directly; only this repository, where the dependency is a workspace link, needs this.
//
// The CLI parses `process.argv` itself on import.
import '@mui/internal-benchmark/cli';
