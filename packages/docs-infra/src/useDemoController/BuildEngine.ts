// The lazy "build engine" chunk for the live-demo runtime: both halves bundled together
// so editing a demo fetches ONE chunk instead of two — the BUILD half (`buildScope` plus
// its scope-assembly and eval machinery) and the RENDER half (`DemoRunner` plus the
// react-runner reimplementation). It is imported DYNAMICALLY (never statically) from
// `useVariantBuilds` (which needs `buildScope`) and `useDemoController` (which needs
// `DemoRunner`), both under the `BuildEngine` webpack chunk name; see those files for
// why the engine is deferred to the first edit. Keeping it out of the eager
// `useDemoController` chunk is the whole point — don't add a static import of this file.
export { buildScope } from './buildScope';
export { DemoRunner } from './DemoRunner';
