'use client';
import * as React from 'react';

export default function SimpleButton() {
  return (
    <button type="button" onClick={() => console.warn('Hello!')}>
      Click me
    </button>
  );
}
