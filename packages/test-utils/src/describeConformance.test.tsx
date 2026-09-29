import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { describe, expect } from 'vitest';
import { createRenderer } from './createRenderer';
import describeConformance from './describeConformance';
import type { ConformanceOptions } from './describeConformance';
import setupVitest from './setupVitest';

interface TestRootProps extends React.HTMLAttributes<HTMLElement> {
  classes?: { root: string };
  component?: React.ElementType;
  layout: 'inline' | 'text' | 'wrapped' | 'portal';
}

const TestRoot = React.forwardRef<HTMLElement, TestRootProps>(function TestRoot(
  { classes, className, component: Component = 'div', layout, ...props },
  ref,
) {
  const root = (
    <Component
      {...props}
      ref={ref}
      className={['Test-root', classes?.root, className].filter(Boolean).join(' ')}
      data-conformance-root=""
    />
  );

  if (layout === 'text') {
    return <React.Fragment>Text before the root{root}</React.Fragment>;
  }

  if (layout === 'portal') {
    return (
      <React.Fragment>
        <button type="button">Open</button>
        {ReactDOM.createPortal(root, document.body)}
      </React.Fragment>
    );
  }

  return layout === 'wrapped' ? <section>{root}</section> : root;
});

describe('describeConformance', () => {
  setupVitest();

  for (const layout of ['inline', 'text', 'wrapped', 'portal'] as const) {
    for (const asyncRender of [false, true]) {
      describe(`${layout}, ${asyncRender ? 'async' : 'sync'} render`, () => {
        const { render } = createRenderer();
        const getRootElement: ConformanceOptions['getRootElement'] = (result) => {
          expect(result.container).to.be.instanceof(HTMLElement);
          const root = result.baseElement.querySelector('[data-conformance-root]');
          expect(root, 'The test component must render a root element.').not.to.equal(null);

          if (layout === 'portal') {
            expect(result.container.querySelector('button')).to.have.text('Open');
            expect(result.container.contains(root)).to.equal(false);
          } else {
            expect(result.container.querySelector('section')).not.to.equal(null);
            expect(result.container.contains(root)).to.equal(true);
          }

          return root;
        };

        describeConformance(<TestRoot layout={layout} />, () => ({
          muiName: 'MuiTest',
          classes: { root: 'Test-root' },
          refInstanceof: window.HTMLDivElement,
          render: asyncRender ? async (node) => render(node) : render,
          ...((layout === 'wrapped' || layout === 'portal') && { getRootElement }),
          only: ['rootClass', 'mergeClassName', 'propsSpread', 'refForwarding', 'componentProp'],
        }));
      });
    }
  }
});
