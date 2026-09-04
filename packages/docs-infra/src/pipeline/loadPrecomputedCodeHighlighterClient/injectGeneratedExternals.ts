import type { GeneratedExternalsModule } from '../generateDemoExternalsModule';
import type { ParsedCreateFactory } from '../parseCreateFactoryCall/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../parseCreateFactoryCall/replacePrecomputeValue';
import { injectImportsIntoSource } from './injectImportsIntoSource';

/** Injects generated static imports and external values into a client factory call. */
export function injectGeneratedExternals(
  source: string,
  demoCall: ParsedCreateFactory,
  generated: GeneratedExternalsModule,
): string {
  const externalsPlaceholder = '__docsInfraExternals';
  const precomputeData = { externals: externalsPlaceholder };
  let modifiedSource = replacePrecomputeValue(source, precomputeData, demoCall, {
    passPrecomputeAsIs: true,
  });
  const serializedPlaceholder = `externals: ${externalsPlaceholder}`;
  if (!modifiedSource.includes(serializedPlaceholder)) {
    throw new Error('Failed to inject resolved demo externals');
  }
  modifiedSource = modifiedSource.replace(
    serializedPlaceholder,
    `externals: ${generated.valueExpression}`,
  );
  return injectImportsIntoSource(modifiedSource, generated.imports);
}
