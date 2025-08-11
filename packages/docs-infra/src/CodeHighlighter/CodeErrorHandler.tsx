'use client';

import * as React from 'react';
import { useErrors } from '../useErrors';
import { ErrorHandlerProps } from './types';

export function CodeErrorHandler({ errors }: ErrorHandlerProps) {
  const context = useErrors();
  errors = context.errors || errors;

  if (!errors || errors.length === 0) {
    return <div>An error occurred, but details were not provided.</div>;
  }

  return (
    <div>
      <span>Error occurred when highlighting code: </span>
      {errors.map((error, index) => (
        <div key={index}>{error.message}</div>
      ))}
    </div>
  );
}
