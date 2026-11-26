import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { configure, createRenderer, renderHook } from './createRenderer';

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
  it.each([false, true])('renders with `reactStrictMode: %s`', (reactStrictMode) => {
    const renderSpy = vi.fn();
    renderHook(() => renderSpy(), { reactStrictMode });

    expect(renderSpy).toHaveBeenCalledTimes(reactStrictMode ? 2 : 1);
  });

  it('uses configured StrictMode unless explicitly overridden', ({ onTestFinished }) => {
    configure({ reactStrictMode: true });
    onTestFinished(() => configure({ reactStrictMode: false }));

    const renderSpy = vi.fn();
    renderHook(() => renderSpy());
    expect(renderSpy).toHaveBeenCalledTimes(2);

    renderSpy.mockClear();
    renderHook(() => renderSpy(), { reactStrictMode: false });
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves the wrapper and hook state when rerendering in StrictMode', () => {
    const Context = React.createContext(0);
    const wrapperRenderSpy = vi.fn();
    function Wrapper({ children }) {
      wrapperRenderSpy();
      return <Context.Provider value={2}>{children}</Context.Provider>;
    }

    const { result, rerender } = renderHook(
      ({ value }) => React.useState(value)[0] + value + React.useContext(Context),
      { initialProps: { value: 1 }, wrapper: Wrapper, reactStrictMode: true },
    );
    expect(result.current).to.equal(4);
    expect(wrapperRenderSpy).toHaveBeenCalledTimes(2);

    rerender({ value: 2 });
    expect(result.current).to.equal(5);
    expect(wrapperRenderSpy).toHaveBeenCalledTimes(4);
  });

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
