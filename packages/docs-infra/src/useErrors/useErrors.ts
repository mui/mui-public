import { useErrorsContext } from './ErrorsContext';

type Errors = {
  errors?: Error[];
};

export function useErrors(): Errors {
  const context = useErrorsContext();

  return { errors: context?.errors };
}
