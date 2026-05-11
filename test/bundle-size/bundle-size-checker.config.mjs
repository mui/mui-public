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
        id: '@mui/internal-docs-infra',
        track: true,
        expand: {
          exclude: ['pipeline/**'],
        },
      },
    ],
    upload: !!process.env.CI,
    comment: true,
  };
});
