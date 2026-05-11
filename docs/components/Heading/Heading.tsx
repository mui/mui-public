import * as React from 'react';
import { Heading } from './Heading.module.css';

export function Heading1({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <a className={Heading}>
      <h1 id={id}>{children}</h1>
    </a>
  );
}

export function Heading2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <a href={`#${id}`} className={Heading}>
      <h2 id={id}>{children}</h2>
    </a>
  );
}

export function Heading3({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <a href={`#${id}`} className={Heading}>
      <h3 id={id}>{children}</h3>
    </a>
  );
}

export function Heading4({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <a href={`#${id}`} className={Heading}>
      <h4 id={id}>{children}</h4>
    </a>
  );
}

export function Heading5({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <a href={`#${id}`} className={Heading}>
      <h5 id={id}>{children}</h5>
    </a>
  );
}

export function Heading6({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <a href={`#${id}`} className={Heading}>
      <h6 id={id}>{children}</h6>
    </a>
  );
}
