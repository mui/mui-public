import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pre } from './Pre';

describe('Pre editor - browser', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the wrapper as one Tab stop, Enter to engage, and Escape to exit', async () => {
    render(
      <Pre fileName="App.tsx" setSource={() => {}}>
        {'const value = 1;'}
      </Pre>,
    );

    const wrapper = screen.getByRole('group', { name: 'Editable code' });
    await userEvent.tab();
    expect(document.activeElement).toBe(wrapper);

    await userEvent.keyboard('{Enter}');
    const textarea = await screen.findByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(textarea.tabIndex).toBe(-1);

    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(wrapper);

    await userEvent.tab();
    expect(document.activeElement).not.toBe(textarea);
  });

  it('indents with Tab while engaged', async () => {
    const setSource = vi.fn();
    render(
      <Pre fileName="App.tsx" setSource={setSource}>
        {'const value = 1;'}
      </Pre>,
    );

    const wrapper = screen.getByRole('group', { name: 'Editable code' });
    wrapper.focus();
    await userEvent.keyboard('{Enter}');
    const textarea = await screen.findByRole('textbox');
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 0);
    await userEvent.keyboard('{Tab}');

    expect((textarea as HTMLTextAreaElement).value).toBe('  const value = 1;');
    expect(setSource).toHaveBeenLastCalledWith(
      '  const value = 1;',
      'App.tsx',
      expect.objectContaining({ position: 2 }),
    );
  });

  it('engages directly from a pointer and activates without an edit', async () => {
    const onActivate = vi.fn();
    const { container } = render(
      <Pre
        fileName="App.tsx"
        setSource={() => {}}
        editActivation="interaction"
        onActivate={onActivate}
      >
        {'const value = 1;'}
      </Pre>,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(container.querySelector('pre')!);

    const textarea = await screen.findByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
