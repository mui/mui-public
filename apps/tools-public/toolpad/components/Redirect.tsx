import * as React from 'react';
import { createComponent } from '@toolpad/studio/browser';

export interface RedirectProps {
  url?: string;
}

function Redirect({ url }: RedirectProps) {
  React.useEffect(() => {
    if (url) {
      window.location.replace(url);
    }
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
