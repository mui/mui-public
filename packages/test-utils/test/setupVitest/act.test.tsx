import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { act, createRenderer, screen } from '../../src/createRenderer';

// The console check of `setupVitest` fails these tests if React 17 logs its `act()` warnings.
describe('act', () => {
  const { render } = createRenderer();

  it('resolves to the value of an awaited sync callback', async () => {
    expect(await act(() => 'value')).to.equal('value');
  });

  it('resolves to the value of an async callback', async () => {
    expect(await act(async () => 'value')).to.equal('value');
  });

  it('rejects when the async callback rejects', async () => {
    await expect(
      act(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
  });

  it('flushes the updates of a sync callback that returns a value', () => {
    let setValue: (value: string) => void = () => {};
    function Component() {
      const [value, setValueState] = React.useState('initial');
      setValue = setValueState;
      return <div data-testid="value">{value}</div>;
    }
    render(<Component />);

    act(() => {
      setValue('updated');
      return true;
    });

    expect(screen.getByTestId('value')).to.have.text('updated');
  });

  it('flushes the updates of an async callback before it resolves', async () => {
    let setValue: (value: string) => void = () => {};
    function Component() {
      const [value, setValueState] = React.useState('initial');
      setValue = setValueState;
      return <div data-testid="value">{value}</div>;
    }
    render(<Component />);

    await act(async () => {
      await Promise.resolve();
      setValue('updated');
    });

    expect(screen.getByTestId('value')).to.have.text('updated');
  });
});
