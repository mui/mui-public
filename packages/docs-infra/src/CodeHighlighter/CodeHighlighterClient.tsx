'use client';

import { useHighlight } from '../HighlightProvider/HighlightContext';

function CodeHighlighterClient() {
  const highlight = useHighlight(); // TODO: use to highlight on the client

  // handles on-hydration and idle switch
}

export default CodeHighlighterClient;
