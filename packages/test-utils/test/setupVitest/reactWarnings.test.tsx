import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { createRenderer, screen } from '../../src/createRenderer';
import { reactMajor } from '../../src/env';

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function TimerUpdate() {
  const [value, setValue] = React.useState('initial');
  React.useEffect(() => {
    // No cleanup: the update can land after unmount.
    setTimeout(() => setValue('updated'));
  }, []);
  return <div data-testid="value">{value}</div>;
}

describe('setupVitest React warnings', () => {
  const { render } = createRenderer();

  // React 18+ still reports this warning, so the check only applies to React 17.
  it.skipIf(reactMajor >= 18)(
    'does not log React 17 act warnings for updates from timers',
    async () => {
      render(<TimerUpdate />);

      await wait(10);

      expect(screen.getByTestId('value')).to.have.text('updated');
    },
  );

  it('ignores React 17 warnings for updates on unmounted components', async () => {
    const { unmount } = render(<TimerUpdate />);
    unmount();

    await wait(10);

    expect(screen.queryByTestId('value')).to.equal(null);
  });
});
