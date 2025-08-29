import { extractNameAndSlugFromUrl } from '../pipeline/loaderUtils';
import { CreateDemoDataMeta, DemoData, DemoGlobalData, DemoGlobalProvider } from './types';

/**
 * Creates demo data for displaying code examples with syntax highlighting.
 * A variant is a different implementation style of the same component.
 * Returns a data object containing demo metadata and components instead of a complete demo component.
 * Note: It is recommended to use abstractCreateDemo to create a complete demo component rather than just demo data.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param variants The variants of the component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export function createDemoDataWithVariants<
  T extends React.ComponentType<any> = React.ComponentType,
>(
  url: string,
  variants: { Default: T } | { [key: string]: T },
  meta?: CreateDemoDataMeta,
): DemoData<T> {
  if (!url.startsWith('file:')) {
    throw new Error(
      'createDemoData() requires the `url` argument to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || (!meta.precompute && !meta.skipPrecompute)) {
    throw new Error(
      `createDemoData() was unable to precompute the code in ${url}. Ensure the createDemoData() function is called within a path used for demo indexes. Run \`pnpm run check:conventions:demo\``,
    );
  }

  const precompute = meta.precompute;

  // Generate name and slug from URL if not provided in meta
  const generatedMeta = extractNameAndSlugFromUrl(url);
  const name = meta.name ?? generatedMeta.name;
  const slug = meta.slug ?? generatedMeta.slug;
  const displayName = meta?.displayName || `${name.replace(/ /g, '')}Demo`;

  return {
    name,
    slug,
    displayName,
    precompute,
    url,
    components: variants,
  };
}

/**
 * Creates demo data for displaying code examples with syntax highlighting.
 * Returns a data object containing demo metadata and components instead of a complete demo component.
 * Note: It is recommended to use abstractCreateDemo to create a complete demo component rather than just demo data.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to be rendered in the demo.
 * @param meta Additional meta for the demo.
 */
export function createDemoData<T extends React.ComponentType<any> = React.ComponentType>(
  url: string,
  component: T,
  meta?: CreateDemoDataMeta,
): DemoData<T> {
  return createDemoDataWithVariants(url, { Default: component }, meta);
}

/**
 * Creates a demo data object for a global provider component with different variants.
 *
 * @param url The URL of the demo file.
 * @param globalProviders The variants of the global provider to be rendered in the demo.
 * @param meta Additional metadata for the demo data.
 * @returns Demo data object.
 */
export function createDemoGlobalWithVariants(
  url: string,
  globalProviders: { [variant: string]: DemoGlobalProvider },
  meta?: CreateDemoDataMeta,
): DemoGlobalData {
  return createDemoDataWithVariants(url, globalProviders, meta);
}

/**
 * Creates a demo data object for a global provider component.
 *
 * @param url The URL of the demo file.
 * @param globalProvider The global provider to be rendered in the demo.
 * @param meta Additional metadata for the demo data.
 * @returns Demo data object.
 */
export function createDemoGlobal(
  url: string,
  globalProvider: DemoGlobalProvider,
  meta?: CreateDemoDataMeta,
): DemoGlobalData {
  return createDemoGlobalWithVariants(url, { Default: globalProvider }, meta);
}
