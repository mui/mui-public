// Runs the `@mui/internal-benchmark` CLI by importing it: the workspace link points at the
// package's `build/`, which has no bin shim until it is built. The CLI parses `process.argv` itself.
import '@mui/internal-benchmark/cli';
