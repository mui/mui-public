import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { LazyContentServer } from './LazyContentServer';

function Hello({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}

describe('LazyContentServer', () => {
  it('awaits the import and returns the component element with its props', async () => {
    const content = () => Promise.resolve({ default: Hello });
    const element = await LazyContentServer({ content, props: { name: 'World' } });

    expect(React.isValidElement(element)).toBe(true);
    expect(element.type).toBe(Hello);
    expect((element.props as { name: string }).name).toBe('World');
  });

  it('defaults props to an empty object when none are given', async () => {
    function NoProps() {
      return <div>static</div>;
    }
    const content = () => Promise.resolve({ default: NoProps });
    const element = await LazyContentServer({ content });

    expect(element.type).toBe(NoProps);
    expect(element.props).toEqual({});
  });
});
