'use client';
import * as React from 'react';

// A small, consistent action button for demo controls (refresh / replay).
export function DemoButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { style, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      style={{
        font: '13px sans-serif',
        padding: '5px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        border: '1px solid #7c3aed',
        background: '#fff',
        color: '#7c3aed',
        ...style,
      }}
    />
  );
}
