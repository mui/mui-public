import type { BenchmarkCaseRuntime } from './types';

const PROFILE_PANEL_STYLE = [
  'position:fixed',
  'top:0',
  'left:0',
  'right:0',
  'z-index:2147483647',
  'display:flex',
  'gap:8px',
  'align-items:center',
  'box-sizing:border-box',
  'padding:8px 12px',
  'background:#1e1e1e',
  'color:#fff',
  'font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  'box-shadow:0 1px 6px rgba(0,0,0,0.5)',
].join(';');

const PROFILE_BUTTON_STYLE = [
  'padding:4px 10px',
  'border:1px solid #555',
  'border-radius:4px',
  'background:#333',
  'color:#fff',
  'cursor:pointer',
  'font:inherit',
].join(';');

function createProfileButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = PROFILE_BUTTON_STYLE;
  return button;
}

// Interactive profiling session: instead of measuring, render a control panel with
// Render / Unmount / Run interaction / Finish buttons that drive the given case runtime. The
// component under test stays unmounted until the user clicks "Render", giving them time to start
// the DevTools profiler first. The returned promise resolves on "Finish", which is what keeps the
// Vitest test (and the headed browser window) alive in between; the caller cleans up afterwards.
export function runProfileSession(name: string, runtime: BenchmarkCaseRuntime): Promise<void> {
  const panel = document.createElement('div');
  panel.setAttribute('data-benchmark-profile-panel', '');
  panel.style.cssText = PROFILE_PANEL_STYLE;

  const title = document.createElement('span');
  title.textContent = `⏱ ${name}`;
  title.style.cssText = 'font-weight:600;white-space:nowrap';

  const status = document.createElement('span');
  status.style.cssText = 'margin-left:auto;opacity:0.85;white-space:nowrap';

  const renderButton = createProfileButton('▶ Render');
  const interactButton = runtime.interact ? createProfileButton('⚡ Run interaction') : null;
  const finishButton = createProfileButton('✓ Finish');

  if (interactButton) {
    interactButton.disabled = true;
  }

  panel.appendChild(title);
  panel.appendChild(renderButton);
  if (interactButton) {
    panel.appendChild(interactButton);
  }
  panel.appendChild(finishButton);
  panel.appendChild(status);
  document.body.appendChild(panel);

  // Push page content below the fixed panel so it doesn't cover the component.
  const spacer = document.createElement('div');
  spacer.style.height = `${panel.offsetHeight}px`;
  document.body.insertBefore(spacer, panel);

  const setStatus = (text: string) => {
    status.textContent = text;
  };

  const show = () => {
    if (runtime.isMounted()) {
      return;
    }
    runtime.mount();
    renderButton.textContent = '■ Unmount';
    if (interactButton) {
      interactButton.disabled = false;
    }
    setStatus('rendered — capture your profile, then Unmount or Finish');
  };

  const hide = () => {
    if (!runtime.isMounted()) {
      return;
    }
    runtime.unmount();
    renderButton.textContent = '▶ Render';
    if (interactButton) {
      interactButton.disabled = true;
    }
    setStatus('unmounted — Render again or Finish');
  };

  setStatus('idle — start the DevTools profiler, then click Render');

  return new Promise<void>((resolve) => {
    renderButton.addEventListener('click', () => (runtime.isMounted() ? hide() : show()));

    if (interactButton) {
      interactButton.addEventListener('click', async () => {
        interactButton.disabled = true;
        setStatus('running interaction…');
        try {
          await runtime.interact?.();
          setStatus('interaction done');
        } catch (error) {
          setStatus(`interaction error: ${String(error)}`);
        } finally {
          if (runtime.isMounted()) {
            interactButton.disabled = false;
          }
        }
      });
    }

    finishButton.addEventListener('click', () => {
      hide();
      spacer.remove();
      panel.remove();
      resolve();
    });
  });
}
