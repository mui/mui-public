import { useErrorsContext } from './ErrorsContext';

type Errors = {
  errors?: Error[];
};

/**
 * Provides access to error state in an isomorphic error handling system.
 * Implements the Props Context Layering pattern to work seamlessly across
 * server and client boundaries.
 *
 * @param props - Optional props containing fallback errors (typically from SSR)
 * @returns Object containing the current errors array (context errors take precedence over props)
 */
export function useErrors(props?: Errors): Errors {
  const context = useErrorsContext();

  // Context errors take precedence over prop errors
  // This ensures client-side errors override server-side errors
  const errors = context?.errors || props?.errors;

  return { errors };
}
