import 'server-only';
import {
  createTypesFactory,
  createMultipleTypesFactory,
} from '@mui/internal-docs-infra/abstractCreateTypes';
import { Pre } from '@/components/Pre';
import { TypesTable } from './TypesTable';

const components = { pre: Pre };

/**
 * Creates a type documentation component for a single component.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param component The component to extract types from.
 * @param meta Additional metadata for the types (injected by loader).
 */
export const createTypes = createTypesFactory({
  TypesContent: TypesTable,
  components,
});

/**
 * Creates type documentation components for multiple related components.
 * Useful for component families like Checkbox.Root, Checkbox.Indicator.
 * @param url Depends on `import.meta.url` to determine the source file location.
 * @param components Object with multiple component exports.
 * @param meta Additional metadata for the types (injected by loader).
 */
export const createMultipleTypes = createMultipleTypesFactory({
  TypesContent: TypesTable,
  components,
});
