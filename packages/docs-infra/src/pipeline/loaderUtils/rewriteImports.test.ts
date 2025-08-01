import { describe, it, expect } from 'vitest';
import { rewriteImportsToSameDirectory } from './rewriteImports';

describe('rewriteImportsToSameDirectory', () => {
  it('should rewrite relative imports based on mapping', () => {
    const source = `
      import Component1 from './Component1';
      import Component2 from '../utils/Component2';
      import { Helper } from '../../shared/helpers';
    `;
    const importPathMapping = new Map([
      ['./Component1', './Component1'],
      ['../utils/Component2', './Component2'],
      ['../../shared/helpers', './helpers'],
    ]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toContain("import Component1 from './Component1'");
    expect(result).toContain("import Component2 from './Component2'");
    expect(result).toContain("import { Helper } from './helpers'");
  });

  it('should handle different file extensions in mappings', () => {
    const source = `
      import Component from './Component.tsx';
      import Helper from '../utils/helper.js';
      import Config from '../../config/config.json';
    `;
    const importPathMapping = new Map([
      ['./Component.tsx', './Component'],
      ['../utils/helper.js', './helper'],
      ['../../config/config.json', './config.json'], // .json files keep their extension
    ]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toContain("import Component from './Component'");
    expect(result).toContain("import Helper from './helper'");
    // .json files are not stripped of their extension
    expect(result).toContain("import Config from './config.json'");
  });

  it('should preserve non-relative imports', () => {
    const source = `
      import React from 'react';
      import { Button } from '@mui/material';
      import Component from './Component';
    `;
    const importPathMapping = new Map([['./Component', './FlatComponent']]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toContain("import React from 'react'");
    expect(result).toContain("import { Button } from '@mui/material'");
    expect(result).toContain("import Component from './FlatComponent'");
  });

  it('should handle imports not in mapping', () => {
    const source = `
      import Component1 from './Component1';
      import Component2 from './Component2';
      import UnknownComponent from './UnknownComponent';
    `;
    const importPathMapping = new Map([
      ['./Component1', './FlatComponent1'],
      ['./Component2', './FlatComponent2'],
      // ./UnknownComponent not in mapping
    ]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toContain("import Component1 from './FlatComponent1'");
    expect(result).toContain("import Component2 from './FlatComponent2'");
    expect(result).toContain("import UnknownComponent from './UnknownComponent'"); // unchanged
  });

  it('should handle named imports', () => {
    const source = `
      import { Component1, Component2 } from '../utils/components';
      import * as Utils from '../../helpers/utils';
    `;
    const importPathMapping = new Map([
      ['../utils/components', './components'],
      ['../../helpers/utils', './utils'],
    ]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toContain("import { Component1, Component2 } from './components'");
    expect(result).toContain("import * as Utils from './utils'");
  });

  it('should handle multiline imports', () => {
    const source = `
      import {
        Component1,
        Component2,
        Component3
      } from '../components/index';
    `;
    const importPathMapping = new Map([['../components/index', './index']]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toContain("from './index'");
  });

  it('should handle empty mapping', () => {
    const source = `
      import Component from './Component';
    `;
    const importPathMapping = new Map<string, string>();

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toBe(source); // unchanged
  });

  it('should handle empty source', () => {
    const source = '';
    const importPathMapping = new Map([['./Component', './FlatComponent']]);

    const result = rewriteImportsToSameDirectory(source, importPathMapping);

    expect(result).toBe('');
  });
});
