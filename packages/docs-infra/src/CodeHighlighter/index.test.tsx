import * as React from 'react';
import type { ContentProps } from './types';
import { CodeHighlighter } from './CodeHighlighter';
import { hastOrJsonToJsx } from '../hast';

function Content(props: ContentProps) {
  return <div>{hastOrJsonToJsx(props.code.Default.source)}</div>;
}

function Default() {
  return <div>Default Component</div>;
}

function A() {
  // This is a simple case where we just pass the code without any precompute
  return (
    <CodeHighlighter
      code={{ Default: { fileName: 'index.js', source: '<div>Default Component</div>' } }}
      Content={Content}
    />
  );
}

function B() {
  return (
    // Single case optimized with precompute
    <CodeHighlighter
      code={{ Default: { fileName: 'index.js', source: '<div>Default Component</div>' } }}
      precompute={{ Default: { fileName: 'index.js', source: { hastJson: '{}' } } }}
      Content={Content}
    />
  );
}

function C() {
  // A demo that will need to load the filenames and source code
  return <CodeHighlighter components={{ Default: <Default /> }} Content={Content} />;
}

function D() {
  // A demo that will need to highlight the code provided
  return (
    <CodeHighlighter
      components={{ Default: <Default /> }}
      code={{ Default: { fileName: 'index.js', source: '<div>Default Component</div>' } }}
      Content={Content}
    />
  );
}

function E() {
  // A demo with precompute optimization
  return (
    <CodeHighlighter
      components={{ Default: <Default /> }}
      precompute={{ Default: { fileName: 'index.js', source: { hastJson: '{}' } } }}
      Content={Content}
    />
  );
}

function F() {
  // A demo with code provided and precompute optimization
  return (
    <CodeHighlighter
      components={{ Default: <Default /> }}
      code={{ Default: { fileName: 'index.js', source: '<div>Default Component</div>' } }}
      precompute={{ Default: { fileName: 'index.js', source: { hastJson: '{}' } } }}
      Content={Content}
    />
  );
}
