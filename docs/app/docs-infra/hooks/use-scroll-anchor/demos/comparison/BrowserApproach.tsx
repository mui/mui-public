'use client';
import * as React from 'react';
import { Timeline } from './Timeline';

// "Browser scroll anchoring" — overflow-anchor: auto. Chromium and Firefox
// nudge the scroll position so the topmost visible element stays put after
// an instant layout change. Safari does not implement this.
//
// Note: native CSS scroll anchoring only kicks in for instant DOM mutations.
// During an animated height transition there is no single layout jump for
// the browser to compensate for, so the reader still drifts.
export function BrowserApproach({ animate }: { animate: boolean }) {
  // @focus-start @padding 1
  const [showOlder, setShowOlder] = React.useState(false);

  return (
    <Timeline
      showOlder={showOlder}
      animate={animate}
      onToggle={() => setShowOlder((prev) => !prev)}
    />
  );
  // @focus-end
}
