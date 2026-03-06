import 'server-only';
import {
  createTypesFactory,
  createMultipleTypesFactory,
  type AbstractCreateTypesOptions,
} from '@mui/internal-docs-infra/abstractCreateTypes';
import { mdxComponents, mdxComponentsInline } from '@/mdx-components';
import { TypesTable } from './TypesTable';

const options = {
  TypesContent: TypesTable,
  components: mdxComponents,
  inlineComponents: mdxComponentsInline,
  typeRefComponent: 'TypeRef' as const,
  typePropRefComponent: 'TypePropRef' as const,
  linkProps: 'deep' as const,
} satisfies AbstractCreateTypesOptions;

/**
 * Creates a type documentation component for a single component.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to extract types from.
 * @param [meta] Additional metadata for the types (injected by loader).
 */
export const createTypes = createTypesFactory(options);

/**
 * Creates type documentation components for multiple related components.
 * Useful for component families like Checkbox.Root, Checkbox.Indicator.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param components Object with multiple component exports.
 * @param [meta] Additional metadata for the types (injected by loader).
 */
export const createMultipleTypes = createMultipleTypesFactory(options);
