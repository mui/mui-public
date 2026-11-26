import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { createRenderer, screen, waitFor } from '../../src/createRenderer';

describe('waitFor', () => {
  const { render } = createRenderer();

  it('resolves while each commit schedules another update', async () => {
    // Node runs about 1000 queued Scheduler tasks of React 17 before a timer, so keep a margin.
    const maxCount = 10000;
    let isUpdating = true;
    function Counter() {
      const [count, setCount] = React.useState(0);
      React.useEffect(() => {
        // Update again right after each commit, so a passive effect is always pending.
        Promise.resolve().then(() => {
          if (isUpdating && count < maxCount) {
            setCount(count + 1);
          }
        });
      }, [count]);
      return <div data-testid="count">{count}</div>;
    }
    render(<Counter />);

    await waitFor(() => {
      expect(screen.getByTestId('count')).not.to.have.text('0');
    });
    isUpdating = false;

    // An `act()` around `waitFor()` only returns once the updates stop at `maxCount`.
    expect(Number(screen.getByTestId('count').textContent)).to.be.below(maxCount);
  });
});
