import type { TypesContentProps } from '../abstractCreateTypes';

/**
 * Hook for accessing types props in TypesContent components.
 */
export function useTypes<T extends {}>(contentProps: TypesContentProps<T>): TypesContentProps<T> {
  return contentProps;
}
