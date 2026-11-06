import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createRenderer, renderHook } from './createRenderer';

describe('createRenderer', () => {
  const { render } = createRenderer();

  it('allows querying descriptions', () => {
    function Component() {
      return (
        <React.Fragment>
          <div id="target" aria-describedby="r:1 r:2 r:3">
            I have a description.
          </div>
          {ReactDOM.createPortal(<div id="r:1">Description 1</div>, document.body)}
          {/* The ID format is important here. It would fail `querySelectorAll('#r:2')` and ensures we use `getElementById` */}
          <div id="r:2">Description 2</div>
          <div id="r:3">Description 3</div>
        </React.Fragment>
      );
    }
    const { getAllDescriptionsOf } = render(<Component />);

    const descriptions = getAllDescriptionsOf(document.getElementById('target'));
    expect(descriptions).to.have.length(3);
    expect(descriptions[0]).to.have.property('id', 'r:1');
    expect(descriptions[1]).to.have.property('id', 'r:2');
    expect(descriptions[2]).to.have.property('id', 'r:3');
  });

  it('renders in StrictMode by default', () => {
    const renderSpy = vi.fn();
    function Component() {
      renderSpy();
      return null;
    }

    render(<Component />);

    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it('does not render in StrictMode with `strict: false`', () => {
    const renderSpy = vi.fn();
    function Component() {
      renderSpy();
      return null;
    }

    render(<Component />, { strict: false });

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

describe('renderHook', () => {
  it('returns the latest result and rerenders with new props', () => {
    const { result, rerender } = renderHook(({ value }) => React.useState(value)[0] + value, {
      initialProps: { value: 1 },
    });
    expect(result.current).to.equal(2);

    rerender({ value: 2 });
    expect(result.current).to.equal(3);
  });

  it('runs effect cleanups on unmount', () => {
    const cleanup = vi.fn();
    const { unmount } = renderHook(() => React.useEffect(() => cleanup, []));
    expect(cleanup).toHaveBeenCalledTimes(0);

    unmount();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
