export {
  createDemoFactory,
  createDemoWithVariantsFactory,
  type CreateDemoConfig,
  type DemoComponent,
  type DemoComponentProps,
} from './abstractCreateDemo';
export { CodeHighlighter } from './CodeHighlighter';
export {
  createStackBlitz,
  openStackBlitz,
  type CreateStackBlitzOptions,
  type StackBlitzProject,
} from './createStackBlitz';
export type {
  CodeHighlighterProps,
  CodePrecompute,
  ContentProps,
  DeferredSources,
  DeferredVariant,
  VariantCode,
  VariantExtraFile,
  VariantExtraFiles,
} from './types';
export { useDemo, type UseDemoOptions, type UseDemoResult } from './useDemo';
export { usePreference } from './usePreference';
