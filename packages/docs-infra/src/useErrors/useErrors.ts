import { useErrorsContext } from './ErrorsContext';

type Errors = {
  errors?: Error[];
};

export function useErrors(props?: Errors): Errors {
  const context = useErrorsContext();

  // Context errors take precedence over prop errors
  // This ensures client-side errors override server-side errors
  const errors = context?.errors || props?.errors;

  return { errors };
}
