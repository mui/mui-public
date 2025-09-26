import { describe, it, expect } from 'vitest';
import { rewriteJsImports, rewriteCssImports } from './rewriteImports';

describe('rewriteJsImports', () => {
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

    const result = rewriteJsImports(source, importPathMapping);

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

    const result = rewriteJsImports(source, importPathMapping);

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

    const result = rewriteJsImports(source, importPathMapping);

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

    const result = rewriteJsImports(source, importPathMapping);

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

    const result = rewriteJsImports(source, importPathMapping);

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

    const result = rewriteJsImports(source, importPathMapping);

    expect(result).toContain("from './index'");
  });

  it('should handle empty mapping', () => {
    const source = `
      import Component from './Component';
    `;
    const importPathMapping = new Map<string, string>();

    const result = rewriteJsImports(source, importPathMapping);

    expect(result).toBe(source); // unchanged
  });

  it('should handle empty source', () => {
    const source = '';
    const importPathMapping = new Map([['./Component', './FlatComponent']]);

    const result = rewriteJsImports(source, importPathMapping);

    expect(result).toBe('');
  });
});

describe('rewriteCssImports', () => {
  it('should rewrite CSS @import statements based on mapping', () => {
    const source = `
      @import './base.css';
      @import '../components/button.css';
      @import '../../theme/colors.css';
    `;
    const importPathMapping = new Map([
      ['./base.css', 'base.css'],
      ['../components/button.css', 'button.css'],
      ['../../theme/colors.css', 'colors.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'base.css'");
    expect(result).toContain("@import 'button.css'");
    expect(result).toContain("@import 'colors.css'");
  });

  it('should handle CSS @import with media queries', () => {
    const source = `
      @import './print.css' print;
      @import '../mobile.css' screen and (max-width: 768px);
      @import '../../dark.css' (prefers-color-scheme: dark);
    `;
    const importPathMapping = new Map([
      ['./print.css', 'print.css'],
      ['../mobile.css', 'mobile.css'],
      ['../../dark.css', 'dark.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'print.css' print");
    expect(result).toContain("@import 'mobile.css' screen and (max-width: 768px)");
    expect(result).toContain("@import 'dark.css' (prefers-color-scheme: dark)");
  });

  it('should handle CSS @import with layers and supports', () => {
    const source = `
      @import './base.css' layer(base);
      @import '../theme.css' layer(theme) supports(display: grid);
      @import '../../utilities.css' layer(utilities) supports(color: color(display-p3 1 0 0));
    `;
    const importPathMapping = new Map([
      ['./base.css', 'base.css'],
      ['../theme.css', 'theme.css'],
      ['../../utilities.css', 'utilities.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'base.css' layer(base)");
    expect(result).toContain("@import 'theme.css' layer(theme) supports(display: grid)");
    expect(result).toContain(
      "@import 'utilities.css' layer(utilities) supports(color: color(display-p3 1 0 0))",
    );
  });

  it('should handle CSS @import with url() function', () => {
    const source = `
      @import url('./reset.css');
      @import url("../components/layout.css");
      @import url('../../fonts/typography.css');
    `;
    const importPathMapping = new Map([
      ['./reset.css', 'reset.css'],
      ['../components/layout.css', 'layout.css'],
      ['../../fonts/typography.css', 'typography.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import url('reset.css')");
    expect(result).toContain('@import url("layout.css")'); // Preserves double quotes
    expect(result).toContain("@import url('typography.css')");
  });

  it('should preserve external URLs in CSS imports', () => {
    const source = `
      @import 'https://fonts.googleapis.com/css2?family=Roboto';
      @import url('https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css');
      @import './local.css';
    `;
    const importPathMapping = new Map([['./local.css', 'local.css']]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'https://fonts.googleapis.com/css2?family=Roboto'");
    expect(result).toContain(
      "@import url('https://cdn.jsdelivr.net/npm/normalize.css@8.0.1/normalize.css')",
    );
    expect(result).toContain("@import 'local.css'");
  });

  it('should handle CSS imports not in mapping', () => {
    const source = `
      @import './mapped.css';
      @import './unmapped.css';
      @import '../another-unmapped.scss';
    `;
    const importPathMapping = new Map([['./mapped.css', 'flat-mapped.css']]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'flat-mapped.css'");
    expect(result).toContain("@import './unmapped.css'"); // unchanged
    expect(result).toContain("@import '../another-unmapped.scss'"); // unchanged
  });

  it('should handle different CSS file extensions', () => {
    const source = `
      @import './styles.css';
      @import '../theme.scss';
      @import '../../variables.less';
      @import '../../../mixins.sass';
    `;
    const importPathMapping = new Map([
      ['./styles.css', 'styles.css'],
      ['../theme.scss', 'theme.scss'],
      ['../../variables.less', 'variables.less'],
      ['../../../mixins.sass', 'mixins.sass'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'styles.css'");
    expect(result).toContain("@import 'theme.scss'");
    expect(result).toContain("@import 'variables.less'");
    expect(result).toContain("@import 'mixins.sass'");
  });

  it('should handle multiline CSS imports', () => {
    const source = `
      @import 
        './base.css'
        layer(base)
        supports(display: grid);
    `;
    const importPathMapping = new Map([['./base.css', 'base.css']]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("'base.css'");
  });

  it('should handle empty CSS mapping', () => {
    const source = `
      @import './styles.css';
    `;
    const importPathMapping = new Map<string, string>();

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toBe(source); // unchanged
  });

  it('should handle empty CSS source', () => {
    const source = '';
    const importPathMapping = new Map([['./styles.css', 'flat-styles.css']]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toBe('');
  });

  it('should handle CSS with mixed content', () => {
    const source = `
      /* Base styles */
      @import './reset.css';
      
      body {
        font-family: Arial, sans-serif;
      }
      
      @import '../components/button.css';
      
      .container {
        max-width: 1200px;
        margin: 0 auto;
      }
    `;
    const importPathMapping = new Map([
      ['./reset.css', 'reset.css'],
      ['../components/button.css', 'button.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain("@import 'reset.css'");
    expect(result).toContain("@import 'button.css'");
    expect(result).toContain('font-family: Arial, sans-serif;');
    expect(result).toContain('max-width: 1200px;');
  });

  it('should preserve complex CSS import metadata combinations', () => {
    const source = `
      @import './base.css' layer(base) supports(display: grid) screen and (min-width: 768px);
      @import url('./theme.css') layer(theme) supports(color: oklch(0.5 0.2 180)) print;
      @import "../components.css" layer(components) (prefers-color-scheme: dark);
    `;
    const importPathMapping = new Map([
      ['./base.css', 'base.css'],
      ['./theme.css', 'theme.css'],
      ['../components.css', 'components.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain(
      "@import 'base.css' layer(base) supports(display: grid) screen and (min-width: 768px)",
    );
    expect(result).toContain(
      "@import url('theme.css') layer(theme) supports(color: oklch(0.5 0.2 180)) print",
    );
    expect(result).toContain(
      '@import "components.css" layer(components) (prefers-color-scheme: dark)',
    );
  });

  it('should preserve whitespace and formatting in CSS imports with metadata', () => {
    const source = `
      @import   './base.css'   layer(base)   screen;
      @import url(  './theme.css'  )  layer( theme )  print ;
      @import
        '../utilities.css'
        layer(utilities)
        supports(display: flex)
        (max-width: 1024px);
    `;
    const importPathMapping = new Map([
      ['./base.css', 'base.css'],
      ['./theme.css', 'theme.css'],
      ['../utilities.css', 'utilities.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    // Should preserve the spacing and formatting
    expect(result).toContain("'base.css'");
    expect(result).toContain("'theme.css'");
    expect(result).toContain("'utilities.css'");
    expect(result).toContain('layer(base)');
    expect(result).toContain('layer( theme )');
    expect(result).toContain('layer(utilities)');
    expect(result).toContain('supports(display: flex)');
  });

  it('should handle edge cases with quoted layer names and complex supports', () => {
    const source = `
      @import './modern.css' layer("base-layer") supports(display: grid and color: color(display-p3 1 0 0));
      @import '../legacy.css' layer('compatibility-layer') supports(not (display: grid));
      @import url("./experimental.css") layer(experimental) supports((display: flex) or (display: grid));
    `;
    const importPathMapping = new Map([
      ['./modern.css', 'modern.css'],
      ['../legacy.css', 'legacy.css'],
      ['./experimental.css', 'experimental.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    expect(result).toContain(
      '\'modern.css\' layer("base-layer") supports(display: grid and color: color(display-p3 1 0 0))',
    );
    expect(result).toContain(
      "'legacy.css' layer('compatibility-layer') supports(not (display: grid))",
    );
    expect(result).toContain(
      'url("experimental.css") layer(experimental) supports((display: flex) or (display: grid))',
    );
  });

  it('should handle full CSS import specification metadata', () => {
    const source = `
      @import './base.css' layer(foundation) supports(display: grid) screen and (min-width: 320px) and (max-width: 1200px);
      @import url('./theme.css') layer("theme-layer") supports(color: oklch(0.5 0.2 180) and (display: flex)) print and (color-gamut: p3);
      @import "../animations.css" layer(animations) supports((animation-timeline: scroll()) or (animation-range: entry)) (prefers-reduced-motion: no-preference);
      @import './utilities.css' layer(utilities) supports(container-type: inline-size) screen and (hover: hover) and (pointer: fine);
    `;
    const importPathMapping = new Map([
      ['./base.css', 'base.css'],
      ['./theme.css', 'theme.css'],
      ['../animations.css', 'animations.css'],
      ['./utilities.css', 'utilities.css'],
    ]);

    const result = rewriteCssImports(source, importPathMapping);

    // Verify each complex import preserves all metadata
    expect(result).toContain(
      "@import 'base.css' layer(foundation) supports(display: grid) screen and (min-width: 320px) and (max-width: 1200px)",
    );
    expect(result).toContain(
      '@import url(\'theme.css\') layer("theme-layer") supports(color: oklch(0.5 0.2 180) and (display: flex)) print and (color-gamut: p3)',
    );
    expect(result).toContain(
      '@import "animations.css" layer(animations) supports((animation-timeline: scroll()) or (animation-range: entry)) (prefers-reduced-motion: no-preference)',
    );
    expect(result).toContain(
      "@import 'utilities.css' layer(utilities) supports(container-type: inline-size) screen and (hover: hover) and (pointer: fine)",
    );
  });
});
