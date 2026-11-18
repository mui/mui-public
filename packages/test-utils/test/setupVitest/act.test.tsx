import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '../../src/createRenderer';

function renderEffect() {
  return renderHook(() => {
    const [value, setValue] = React.useState('initial');
    const effectValue = React.useRef(value);
    React.useEffect(() => {
      effectValue.current = value;
    }, [value]);
    return { setValue, effectValue };
  }).result.current;
}

// The console check of `setupVitest` fails these tests if React 17 logs its `act()` warnings.
describe('act', () => {
  it('resolves to the value of an awaited sync callback', async () => {
    expect(await act(() => 'value')).to.equal('value');
  });

  it('can await the results of completed sync calls together', async () => {
    const first = act(() => 'first');
    const second = act(() => 'second');

    expect(await Promise.all([first, second])).to.deep.equal(['first', 'second']);
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
    const { setValue, effectValue } = renderEffect();

    act(() => {
      setValue('updated');
      return true;
    });

    expect(effectValue.current).to.equal('updated');
  });

  it('flushes effects scheduled by microtasks when a sync callback is awaited', async () => {
    const { setValue, effectValue } = renderEffect();
    async function save() {
      await Promise.resolve();
      return 'saved';
    }

    await act(() => {
      // A click handler can start a save and return before it finishes.
      save().then(setValue);
    });

    expect(effectValue.current).to.equal('saved');
  });

  it('flushes the updates of an async callback before it resolves', async () => {
    const { setValue, effectValue } = renderEffect();

    await act(async () => {
      await Promise.resolve();
      setValue('updated');
    });

    expect(effectValue.current).to.equal('updated');
  });
});
