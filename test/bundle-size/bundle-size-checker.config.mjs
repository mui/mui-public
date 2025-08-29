/**
 * @file Configuration file for bundle-size-checker
 *
 * This file determines which packages and components will have their bundle sizes measured.
 */
import { defineConfig } from '@mui/internal-bundle-size-checker';

/**
 * Generates the entrypoints configuration by scanning the exports field in package.json.
 */
export default defineConfig(async () => {
  return {
    entrypoints: [
      {
        id: 'Base UI checkbox',
        code: `
          import * as React from 'react';
          import { Checkbox } from '@base-ui-components/react/checkbox';

          export default function ExampleCheckbox() {
            return (<>
              <Checkbox.Root />
              <Checkbox.Indicator />
            </>)
          }
        `,
        externals: ['react', 'react-dom'],
      },
      { id: '@base-ui-components/react', track: true, expand: true },
      '@base-ui-components/react/checkbox#Checkbox',
      '@mui/x-charts-pro/BarChartPro',
    ],
    upload: !!process.env.CI,
    comment: true,
  };
});
