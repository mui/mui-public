'use client';

import * as React from 'react';
import { Dialog } from '@base-ui/react/dialog';
import type { useDemo } from '@mui/internal-docs-infra/useDemo';
import styles from './BenchViewer.module.css';

const metricNames: Record<string, string | undefined> = {
  FCP: 'First Contentful Paint',
  LCP: 'Largest Contentful Paint',
  CLS: 'Cumulative Layout Shift',
  INP: 'Interaction to Next Paint',
  TTI: 'Time to Interactive',
  TBT: 'Total Blocking Time',
  'long-task': 'Long Task',
};

const metricUnits: Record<string, string | undefined> = {
  FCP: 'ms',
  LCP: 'ms',
  INP: 'ms',
  TTI: 'ms',
  TBT: 'ms',
  'long-task': 'ms',
};

export function BenchViewer({
  url,
  demo,
}: {
  url: string | undefined;
  demo: ReturnType<typeof useDemo>;
}) {
  const { name } = demo.userProps;
  const demoURL = new URL('.', url).toString().slice(0, -1); // remove filename and trailing slash
  const lastAppIndex = demoURL ? demoURL.lastIndexOf('app/') : -1;
  const demoPath = lastAppIndex !== -1 ? demoURL!.substring(lastAppIndex + 3) : demoURL || '';

  const [open, setOpen] = React.useState(false);
  const [benchShown, setBenchShown] = React.useState(false);
  const [waitingForTTI, setWaitingForTTI] = React.useState(false);
  const [metrics, setMetrics] = React.useState<
    {
      name: string;
      rating?: string;
      value: number;
      metadata?: any;
    }[]
  >([]);

  // reset benchmarks when reopening
  React.useEffect(() => {
    if (open) {
      setMetrics([]);
      setBenchShown(false);
      setWaitingForTTI(false);
      // request idle callback
      window.requestIdleCallback(() => {
        setBenchShown(true);
        // Start waiting for TTI after FCP is received
        setWaitingForTTI(true);
      });
    }
  }, [open]);

  React.useEffect(() => {
    const callback = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return; // our iframes are always same origin
      }

      if (event.data?.source !== 'docs-infra:bench') {
        return;
      }

      if (event.data.type === 'web-vitals' && event.data.metric) {
        // Stop waiting for TTI when it or TBT arrives (since TBT comes right after TTI)
        if (event.data.metric.name === 'TTI' || event.data.metric.name === 'TBT') {
          setWaitingForTTI(false);
        }

        setMetrics((prevMetrics) => [
          ...prevMetrics,
          {
            name: event.data.metric.name,
            rating: event.data.metric.rating,
            value: event.data.metric.value,
            metadata: event.data.metric.metadata,
          },
        ]);
      }
    };
    window.addEventListener('message', callback, false);

    return () => {
      window.removeEventListener('message', callback);
    };
  }, []);

  const frameRef = React.useRef<HTMLIFrameElement>(null);
  // When interaction is re-enabled, ensure the iframe regains focus
  React.useEffect(() => {
    if (!waitingForTTI && open && benchShown) {
      // Try focusing iframe element and its contentWindow for wheel/scroll
      const el = frameRef.current;
      // Defer to next frame to ensure overlay is removed
      requestAnimationFrame(() => {
        try {
          el?.focus();
          el?.contentWindow?.focus();
        } catch {
          // noop
        }
      });
    }
  }, [waitingForTTI, open, benchShown]);

  const refreshFrame = React.useCallback(() => {
    setMetrics([]);
    setWaitingForTTI(false); // Reset waiting state first
    setBenchShown(false); // Hide the iframe temporarily

    if (frameRef.current) {
      // Resetting the src forces a reload, which is important to get fresh metrics
      const currentSrc = frameRef.current.src;
      frameRef.current.src = currentSrc;
    }

    // Restart the benchmark process after a brief delay
    window.requestIdleCallback(() => {
      setBenchShown(true);
      setWaitingForTTI(true); // Start waiting for TTI again
    });
  }, []);

  const openInNewTab = React.useCallback(() => {
    window.open(demoPath, '_blank', 'noopener,noreferrer');
  }, [demoPath]);

  return (
    <div className={styles.Root}>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className={styles.Button}>Start Benchmark</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.Backdrop} />
          <Dialog.Popup className={styles.Popup}>
            <div className={styles.Interactive}>
              <Dialog.Title className={styles.Title}>{name} Benchmark</Dialog.Title>
              <div className={styles.Results}>
                {metrics.map((metric, index) => (
                  <div key={`${metric.name}-${index}`}>
                    <strong>{metricNames[metric.name] || metric.name}</strong>:{' '}
                    {Math.round(metric.value)}
                    {metricUnits[metric.name] || ''} {metric.rating && `(${metric.rating})`}
                    {metric.name === 'long-task' && metric.metadata && (
                      <div style={{ marginLeft: '20px', fontSize: '0.9em', color: '#666' }}>
                        <div>Start: {Math.round(metric.metadata.startTime)}ms</div>
                        <div>Severity: {metric.metadata.severity}</div>
                        <div>Source: {metric.metadata.source || 'Unknown'}</div>
                      </div>
                    )}
                  </div>
                ))}
                {waitingForTTI && (
                  <div style={{ fontStyle: 'italic', color: '#888', marginTop: '8px' }}>
                    Waiting for 5 seconds of JS Idle...
                  </div>
                )}
              </div>
              <div className={styles.Actions}>
                <Dialog.Close className={styles.Button}>Close</Dialog.Close>
                <button className={styles.Button} type="button" onClick={refreshFrame}>
                  Reload
                </button>
                <button className={styles.Button} type="button" onClick={openInNewTab}>
                  Open
                </button>
              </div>
            </div>
            <div
              className={[styles.FrameContainer, waitingForTTI && styles.isDisabled]
                .filter(Boolean)
                .join(' ')}
            >
              {open && benchShown ? (
                <iframe
                  className={styles.Frame}
                  src={demoPath}
                  title="Bench Viewer"
                  tabIndex={-1}
                  ref={frameRef}
                />
              ) : null}
              {waitingForTTI ? <div className={styles.FrameBlocker} aria-hidden /> : null}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
