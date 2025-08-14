# @mui/internal-code-infra

Build scripts and configs to be used across MUI repos.

## Build tool exploration

### Vite

Pros:

1. Familiar setup. We already use it via vitest and bundle-size-checker
2. No extra dependencies to add
3. Has watch mode.
4. No workspace mode.

Cons:

1. File tree structure is not maintained.
2. Only the entry files are kept as specified in input. Other files are either moved into a shared chunk (if used across other files) or are collapsed into the entry file. Not really a major con but something to keep in consideration.
3. No ts support out of the box. Even integrating via `unplugin-dts` just outputs the d.ts files in the same structure as you'd get with `tsc`. No 1:1 correlation with the built js files. We'd have to do what we get prebuilt in tsdown.

### tsdown

Pros:

1. Works out of the box for cjs/mjs/d.ts file generation. No extra setup for typescript needed.
2. Ability to maintain the same structure as the source files.
3. Has watch mode.
4. Has workspace mode. Can potentially build all the packages with a single cli call in the same process.

Cons:

1. Still a beta software.
