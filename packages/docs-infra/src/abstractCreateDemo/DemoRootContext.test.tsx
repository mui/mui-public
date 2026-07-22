/** @vitest-environment jsdom */
import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DemoRootContext, DemoRootProvider } from './DemoRootContext';

function RootReader() {
  const rootRef = React.useContext(DemoRootContext);
  const [className, setClassName] = React.useState('');
  React.useEffect(() => {
    setClassName(rootRef?.current?.className ?? '');
  }, [rootRef]);
  return <span data-testid="root-class">{className}</span>;
}

describe('DemoRootProvider', () => {
  it('provides the demo root element to descendants', async () => {
    render(
      <DemoRootProvider>
        <RootReader />
      </DemoRootProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('root-class').textContent).toBe('demo'));
  });
});
