/**
 * Export VariantCode as Create React App template using exportVariant
 * This is a general-purpose wrapper that creates CRA-compatible templates
 * without library-specific dependencies
 */

import type { VariantCode } from '../CodeHighlighter/types';
import { exportVariant, type ExportConfig } from './exportVariant';

/**
 * Export a VariantCode as a Create React App template
 * Returns an object with the exported VariantCode and entrypoint path
 */
export function exportVariantAsCra(
  variantCode: VariantCode,
  config: ExportConfig = {},
): { exported: VariantCode; rootFile: string } {
  const {
    title = 'Demo',
    description = 'Demo created with Create React App',
    scripts = {},
    devDependencies = {},
    ...otherConfig
  } = config;

  // Default CRA scripts
  const craScripts = {
    start: 'react-scripts start',
    build: 'react-scripts build',
    test: 'react-scripts test',
    eject: 'react-scripts eject',
    ...scripts,
  };

  // CRA only needs react-scripts, other deps are handled by exportVariant
  const craDevDependencies = {
    'react-scripts': 'latest',
    ...devDependencies,
  };

  // Create export configuration for CRA
  const exportConfig: ExportConfig = {
    title,
    description,
    htmlPrefix: 'public/',
    packageType: undefined, // CRA should not have 'type: module'
    htmlSkipJsLink: true,
    frameworkFiles: {}, // Prevent Vite-specific files from being generated
    devDependencies: craDevDependencies,
    scripts: craScripts,
    ...otherConfig,
  };

  // Use exportVariant to generate the final result
  return exportVariant(variantCode, exportConfig);
}
