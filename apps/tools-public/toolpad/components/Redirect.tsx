import * as React from 'react';
import { createComponent } from '@toolpad/studio/browser';

export interface RedirectProps {
  url?: string;
}

function Redirect({ url }: RedirectProps) {
  React.useEffect(() => {
    if (!url) {
      return undefined;
    }

    const targetUrl = new URL(url, window.location.href);

    const ALLOWED_ORIGINS = new Set([window.location.origin, 'https://frontend-public.mui.com']);
    if (!ALLOWED_ORIGINS.has(targetUrl.origin)) {
      throw new Error(`Disallowed redirect origin: ${targetUrl.origin}`);
    }

    const timeout = setTimeout(() => {
      window.location.replace(targetUrl.toString());
    }, 3000);

    return () => {
      clearTimeout(timeout);
    };
  }, [url]);

  if (!url) {
    return <div style={{ height: 10 }} />;
  }

  return <div>Redirection in progress…</div>;
}

export default createComponent(Redirect, {
  argTypes: {
    url: {
      type: 'string',
    },
  },
});
