import type { TypesContentProps } from '../abstractCreateTypes';

export function useTypes<T extends {}>(contentProps: TypesContentProps<T>): TypesContentProps<T> {
  // We can add client side logic here if needed

  return contentProps;
}
