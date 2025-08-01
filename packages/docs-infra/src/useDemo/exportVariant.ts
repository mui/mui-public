/**
 * Export variant functionality to add extra files like package.json, tsconfig, etc.
 * Users can pass configuration options that vary the output here.
 */

import type { VariantCode } from '../CodeHighlighter/types';
import { externalsToPackages } from '../loaderUtils';
import { getFileNameFromUrl } from '../loaderUtils/getFileNameFromUrl';
import { createPathContext } from './examineVariant';

/**
 * Extract filename from URL or return undefined if not available
 */
export function getFilenameFromVariant(variantCode: VariantCode): string | undefined {
  if (variantCode.fileName) {
    return variantCode.fileName;
  }
  if (variantCode.url) {
    const { fileName } = getFileNameFromUrl(variantCode.url);
    return fileName || undefined;
  }
  return undefined;
}

/**
 * Generate a unique entrypoint filename that doesn't conflict with existing files
 */
export function generateEntrypointFilename(
  existingFiles: Record<string, any>,
  sourceFilename: string | undefined,
  useTypescript: boolean,
  pathPrefix: string = '',
): string {
  const ext = useTypescript ? 'tsx' : 'jsx';
  const candidates = [
    `${pathPrefix}index.${ext}`,
    `${pathPrefix}entrypoint.${ext}`,
    `${pathPrefix}main.${ext}`,
  ];

  // If we have a source filename, also try variations
  if (sourceFilename) {
    const baseName = sourceFilename.replace(/\.[^.]*$/, '');
    candidates.push(`${pathPrefix}${baseName}-entry.${ext}`);
  }

  for (const candidate of candidates) {
    if (candidate !== `${pathPrefix}${sourceFilename}` && !existingFiles[candidate]) {
      return candidate;
    }
  }

  // Generate with hash if all candidates are taken
  const hash = Math.random().toString(36).substring(2, 8);
  return `${pathPrefix}entrypoint-${hash}.${ext}`;
}

/**
 * Generate the relative import path from entrypoint to source file
 */
export function getRelativeImportPath(sourceFilename: string | undefined): string {
  if (!sourceFilename) {
    return './App'; // Default fallback
  }

  // Remove extension for import
  const baseName = sourceFilename.replace(/\.[^.]*$/, '');
  return `./${baseName}`;
}

/**
 * Default HTML template function for Vite-based demos
 */
export function defaultHtmlTemplate({
  language,
  title,
  description,
  head,
  entrypoint,
}: {
  language: string;
  title: string;
  description: string;
  head?: string;
  entrypoint: string;
}): string {
  return `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <meta name="description" content="${description}" />${head ? `\n    ${head}` : ''}
  </head>
  <body>
    <div id="root"></div>${entrypoint ? `\n    <script type="module" src="${entrypoint}"></script>` : ''}
  </body>
</html>`;
}

export interface ExportConfig {
  /** The title for the demo (used in HTML title and package.json name) */
  title?: string;
  /** Description for package.json */
  description?: string;
  /**
   * Prefix for output file paths (e.g., 'public/' for CRA, '' for Vite)
   * @example
   * htmlPrefix: 'public/' // outputs index.html to correct depth + public/index.html
   */
  htmlPrefix?: string;
  /**
   * Whether the framework handles entrypoint and HTML generation (e.g., CRA with webpack)
   * When true, skips generating index.html and entrypoint files
   */
  frameworkHandlesEntrypoint?: boolean;
  /**
   * Custom HTML template function
   * @example
   * htmlTemplate: ({ language, title, description, head, entrypoint }) =>
   *   `<!doctype html><html><head><title>${title}</title>${head || ''}</head><body><div id="root"></div><script src="${entrypoint}"></script></body></html>`
   */
  htmlTemplate?: (params: {
    language: string;
    title: string;
    description: string;
    head?: string;
    entrypoint: string;
  }) => string;
  /**
   * Custom head template function for generating additional head content
   * @example
   * headTemplate: ({ sourcePrefix, assetPrefix }) =>
   *   `<link rel="stylesheet" href="${assetPrefix}/styles.css" />\n<meta name="theme-color" content="#000000" />`
   */
  headTemplate?: (params: { sourcePrefix: string; assetPrefix: string }) => string;
  /** Custom React root index template function */
  rootIndexTemplate?: (params: { importString: string; useTypescript: boolean }) => string;
  /** Extra package.json dependencies to add */
  dependencies?: Record<string, string>;
  /** Extra package.json devDependencies to add */
  devDependencies?: Record<string, string>;
  /** Extra package.json scripts to add */
  scripts?: Record<string, string>;
  /** Package type: 'module' for ESM, 'commonjs' for CJS, undefined to omit */
  packageType?: 'module' | 'commonjs';
  /** Custom package.json fields to merge */
  packageJsonFields?: Record<string, any>;
  /** Extra tsconfig.json options to merge */
  tsconfigOptions?: Record<string, any>;
  /** Whether to include TypeScript configuration files */
  useTypescript?: boolean;
  /** Custom metadata files to add */
  extraMetadataFiles?: Record<string, { source: string; metadata?: boolean }>;
  /** Framework-specific files that override default files (index.html, entrypoint, etc.) */
  frameworkFiles?: Record<string, { source: string; metadata?: boolean }>;
}

/**
 * Export a VariantCode with additional configuration files
 * Returns an object with the exported VariantCode and rootPath path
 */
export function exportVariant(
  variantCode: VariantCode,
  config: ExportConfig = {},
): { exported: VariantCode; rootFile: string } {
  const {
    title = 'Demo',
    description = 'Demo created with Vite',
    htmlPrefix = '',
    frameworkHandlesEntrypoint = false,
    htmlTemplate,
    headTemplate,
    rootIndexTemplate,
    dependencies = {},
    devDependencies = {},
    scripts = {},
    packageType,
    packageJsonFields = {},
    tsconfigOptions = {},
    useTypescript = false,
    extraMetadataFiles = {},
    frameworkFiles = {},
  } = config;

  // If packageType is explicitly provided (even as undefined), use that value
  let finalPackageType: 'module' | 'commonjs' | undefined;
  if ('packageType' in config) {
    finalPackageType = packageType;
  } else {
    finalPackageType = !Object.keys(frameworkFiles).length ? 'module' : undefined;
  }

  // Get existing extraFiles and source filename
  const existingExtraFiles = variantCode.extraFiles || {};
  const sourceFilename = getFilenameFromVariant(variantCode);

  // Get path context to calculate proper URLs
  const pathContext = createPathContext(variantCode);

  // Calculate the correct prefix for metadata files based on path depth
  const metadataPrefix = '../'.repeat(pathContext.maxBackNavigation + 1);

  // Generate unique entrypoint filename
  const entrypointFilename = generateEntrypointFilename(
    existingExtraFiles,
    sourceFilename,
    useTypescript,
  );

  // Calculate the entrypoint URL relative to the root
  const entrypoint = `/src/${pathContext.pathInwardFromRoot}${entrypointFilename}`;

  // Get relative import path for the main component
  const rootFile = `src/${pathContext.pathInwardFromRoot}${sourceFilename}`;
  const importPath = getRelativeImportPath(sourceFilename);
  const importString = variantCode.namedExport
    ? `import { ${variantCode.namedExport} as App } from '${importPath}';`
    : `import App from '${importPath}';`;

  // Create new extraFiles object
  const newExtraFiles = { ...existingExtraFiles };

  // Add framework-specific files (if any)
  for (const [fileName, fileData] of Object.entries(frameworkFiles)) {
    newExtraFiles[fileName] = {
      source: fileData.source,
      metadata: fileData.metadata ?? true,
    };
  }

  // Check if we're using a framework (has framework files)
  const isFramework = frameworkFiles && Object.keys(frameworkFiles).length > 0;

  const externalPackages = externalsToPackages(variantCode.externals || []);
  const variantDeps = Object.keys(externalPackages).reduce(
    (acc, pkg) => {
      acc[pkg] = 'latest';
      return acc;
    },
    {} as Record<string, string>,
  );

  // Generate package.json (always)
  const packageJson = {
    private: true,
    name: title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    version: '0.0.0',
    description,
    ...(finalPackageType && { type: finalPackageType }), // Add type if specified
    scripts: {
      ...(!isFramework && {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      }),
      ...scripts,
    },
    dependencies: {
      react: 'latest',
      'react-dom': 'latest',
      ...variantDeps,
      ...dependencies,
    },
    devDependencies: {
      ...(!isFramework && {
        '@vitejs/plugin-react': 'latest',
        vite: 'latest',
      }),
      ...(useTypescript && {
        typescript: 'latest',
        '@types/react': 'latest',
        '@types/react-dom': 'latest',
      }),
      ...devDependencies,
    },
    ...packageJsonFields,
  };

  newExtraFiles[`${metadataPrefix}package.json`] = {
    source: JSON.stringify(packageJson, null, 2),
    metadata: true,
  };

  // Generate entrypoint and HTML files unless framework handles them
  if (!frameworkHandlesEntrypoint) {
    // Add index.html (with configurable prefix for different frameworks)
    const headContent = headTemplate
      ? headTemplate({
          sourcePrefix: '/src',
          assetPrefix: '',
        })
      : undefined;

    const htmlContent = htmlTemplate
      ? htmlTemplate({
          language: 'en',
          title,
          description,
          head: headContent,
          entrypoint,
        })
      : defaultHtmlTemplate({
          language: 'en',
          title,
          description,
          head: headContent,
          entrypoint,
        });

    const htmlFilePath = htmlPrefix
      ? `${metadataPrefix}${htmlPrefix}index.html`
      : `${metadataPrefix}index.html`;
    newExtraFiles[htmlFilePath] = {
      source: htmlContent,
      metadata: true,
    };

    // Create entrypoint file that imports the main component
    const defaultEntrypointContent = `import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
${importString}

ReactDOM.createRoot(document.getElementById('root')${useTypescript ? '!' : ''}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;

    const entrypointContent = rootIndexTemplate
      ? rootIndexTemplate({
          importString,
          useTypescript,
        })
      : defaultEntrypointContent;

    newExtraFiles[entrypointFilename] = {
      source: entrypointContent,
      metadata: false,
    };
  }

  // Add Vite config file only if no framework files (Vite-specific)
  if (!isFramework) {
    const viteConfigContent = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { externalsToPackages } from '../loaderUtils/externalsToPackages';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { 'process.env': {} },
});`;

    newExtraFiles[`${metadataPrefix}vite.config.${useTypescript ? 'ts' : 'js'}`] = {
      source: viteConfigContent,
      metadata: true,
    };
  }

  // Add TypeScript configuration if requested (up one directory, metadata: true)
  if (useTypescript) {
    // Check if frameworkFiles already includes a tsconfig
    const hasFrameworkTsConfig =
      frameworkFiles &&
      Object.keys(frameworkFiles).some(
        (fileName) =>
          fileName.includes('tsconfig.json') && !fileName.includes('tsconfig.node.json'),
      );

    if (!hasFrameworkTsConfig) {
      // Main tsconfig.json (default Vite config)
      const defaultTsConfig = {
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
          ...tsconfigOptions,
        },
        include: ['src'],
        ...(!isFramework && {
          references: [{ path: './tsconfig.node.json' }],
        }),
      };

      newExtraFiles[`${metadataPrefix}tsconfig.json`] = {
        source: JSON.stringify(defaultTsConfig, null, 2),
        metadata: true,
      };
    }

    // Only add tsconfig.node.json for Vite (not for framework files)
    if (!isFramework) {
      // Node tsconfig for Vite config
      const nodeTsConfig = {
        compilerOptions: {
          composite: true,
          skipLibCheck: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          allowSyntheticDefaultImports: true,
        },
        include: ['vite.config.ts'],
      };

      newExtraFiles[`${metadataPrefix}tsconfig.node.json`] = {
        source: JSON.stringify(nodeTsConfig, null, 2),
        metadata: true,
      };
    }
  }

  // Add custom metadata files (respect metadata flag)
  for (const [fileName, fileData] of Object.entries(extraMetadataFiles)) {
    newExtraFiles[`${metadataPrefix}${fileName}`] = {
      source: fileData.source,
      metadata: fileData.metadata ?? true,
    };
  }

  // Return new VariantCode with updated extraFiles
  return {
    exported: {
      ...variantCode,
      extraFiles: newExtraFiles,
    },
    rootFile,
  };
}
