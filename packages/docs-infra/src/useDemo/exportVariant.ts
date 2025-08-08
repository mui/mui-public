/**
 * Export variant functionality to add extra files like package.json, tsconfig, etc.
 * Users can pass configuration options that vary the output here.
 */

import type { VariantCode, VariantExtraFiles } from '../CodeHighlighter/types';
import { externalsToPackages } from '../pipeline/loaderUtils';
import { getFileNameFromUrl } from '../pipeline/loaderUtils/getFileNameFromUrl';
import { createPathContext } from '../CodeHighlighter/examineVariant';
import { mergeMetadata, extractMetadata } from '../CodeHighlighter/mergeMetadata';

/**
 * Merges multiple file objects into a single object.
 * Similar to mergeExternals but for file structures.
 * Automatically adds metadata: false to files that don't have a metadata property.
 */
function mergeFiles(...fileSets: Array<VariantExtraFiles>): VariantExtraFiles {
  const merged: VariantExtraFiles = {};

  for (const fileSet of fileSets) {
    for (const [fileName, fileData] of Object.entries(fileSet)) {
      // Later files override earlier ones (similar to Object.assign behavior)
      const normalizedData = typeof fileData === 'string' ? { source: fileData } : { ...fileData };
      // Add metadata: false if not already set (source files default to false)
      if (!('metadata' in normalizedData)) {
        normalizedData.metadata = false;
      }
      merged[fileName] = normalizedData;
    }
  }

  return merged;
}

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
  existingFiles: VariantExtraFiles,
  sourceFilename: string | undefined,
  useTypescript: boolean,
  pathPrefix: string = '',
): string {
  const ext = useTypescript ? 'tsx' : 'jsx';
  const candidates = [
    `${pathPrefix}App.${ext}`,
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
  /** Optional prefix to add before the title */
  titlePrefix?: string;
  /** Optional suffix to add after the title */
  titleSuffix?: string;
  /** Description for package.json */
  description?: string;
  /** Optional prefix to add before the description */
  descriptionPrefix?: string;
  /** Optional suffix to add after the description */
  descriptionSuffix?: string;
  /** The variant name/identifier for this specific code variant */
  variantName?: string;
  /**
   * Language for the HTML document (default is 'en')
   */
  language?: string;
  /**
   * Prefix for output file paths (e.g., 'public/' for CRA, '' for Vite)
   * @example
   * htmlPrefix: 'public/' // outputs index.html to correct depth + public/index.html
   */
  htmlPrefix?: string;
  /**
   * Prefix for asset files (e.g., 'assets/' for CRA)
   */
  assetPrefix?: string;
  /**
   * Prefix for code files (e.g., 'src/' for Vite)
   */
  sourcePrefix?: string;
  /**
   * Custom HTML template function
   * @example
   * htmlTemplate: ({ language, title, description, head, entrypoint, variant, variantName }) =>
   *   `<!doctype html><html><head><title>${title}</title>${head || ''}</head><body><div id="root"></div><script src="${entrypoint}"></script></body></html>`
   */
  htmlTemplate?: (params: {
    language: string;
    title: string;
    description: string;
    head?: string;
    entrypoint: string;
    variant?: VariantCode;
    variantName?: string;
  }) => string;
  /**
   * Custom head template function for generating additional head content
   * @example
   * headTemplate: ({ sourcePrefix, assetPrefix, variant, variantName }) =>
   *   `<link rel="stylesheet" href="${assetPrefix}/styles.css" />\n<meta name="theme-color" content="#000000" />`
   */
  headTemplate?: (params: {
    sourcePrefix: string;
    assetPrefix: string;
    variant?: VariantCode;
    variantName?: string;
  }) => string;
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
  extraMetadataFiles?: Record<string, { source: string }>;
  /**
   * Whether the framework handles entrypoint and HTML generation (e.g., CRA with webpack)
   * When true, skips generating index.html and entrypoint files
   */
  frameworkHandlesEntrypoint?: boolean;
  /** Framework-specific files that override default files (index.html, entrypoint, etc.) */
  frameworkFiles?: { variant?: VariantCode; globals?: VariantExtraFiles };
  /**
   * Custom export function to use instead of the default exportVariant or exportVariantAsCra
   * @example
   * exportFunction: (variantCode, config) => ({ exported: customProcessedCode, rootFile: 'custom-entry.js' })
   */
  exportFunction?: (
    variantCode: VariantCode,
    config: ExportConfig,
  ) => { exported: VariantCode; rootFile: string };
  /**
   * Transform function that runs at the very start of the export process
   * Can modify the variant code and metadata before any other processing happens
   * @example
   * transformVariant: (variant, globals, variantName) => ({
   *   variant: { ...variant, source: modifiedSource },
   *   globals: { ...globals, extraFiles: { ...globals.extraFiles, 'theme.css': { source: '.new {}', metadata: true } } }
   * })
   */
  transformVariant?: (
    variant: VariantCode,
    variantName?: string,
    globals?: VariantExtraFiles,
  ) => { variant?: VariantCode; globals?: VariantExtraFiles } | undefined;
  /**
   * Version overrides for core packages (react, react-dom, @types/react, @types/react-dom)
   * @example
   * versions: {
   *   '@types/react': '^19',
   *   '@types/react-dom': '^19',
   *   react: '^19',
   *   'react-dom': '^19',
   * }
   */
  versions?: Record<string, string>;
  /**
   * Custom dependency resolution function
   * @example
   * resolveDependencies: (packageName, envVars) => {
   *   if (packageName === '@mui/material') {
   *     return { '@mui/material': 'latest', '@emotion/react': 'latest' };
   *   }
   *   return { [packageName]: 'latest' };
   * }
   */
  resolveDependencies?: (
    packageName: string,
    envVars?: Record<string, string>,
  ) => Record<string, string>;
}

/**
 * Export a variant as a standalone project with metadata files properly scoped
 */
export function exportVariant(
  variantCode: VariantCode,
  config: ExportConfig = {},
): { exported: VariantCode; rootFile: string } {
  const {
    title = 'Demo',
    titlePrefix,
    titleSuffix,
    description = 'Demo created with Vite',
    descriptionPrefix,
    descriptionSuffix,
    variantName,
    language = 'en',
    htmlPrefix = '',
    sourcePrefix = 'src/',
    assetPrefix = '',
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
    transformVariant,
    versions = {},
    resolveDependencies,
  } = config;

  // Build final title and description with prefixes and suffixes
  const finalTitle = [titlePrefix, title, titleSuffix].filter(Boolean).join('');
  const finalDescription = [descriptionPrefix, description, descriptionSuffix]
    .filter(Boolean)
    .join('');

  // Use extractMetadata to properly separate metadata and non-metadata files
  let { variant: processedVariantCode, metadata: processedGlobals } = extractMetadata(variantCode);

  if (transformVariant) {
    const transformed = transformVariant(processedVariantCode, variantName, processedGlobals);
    if (transformed) {
      // Re-extract metadata after transformation
      const result = extractMetadata(transformed.variant || variantCode);
      processedVariantCode = result.variant;
      // Combine metadata from extraction with transformed globals
      processedGlobals = { ...result.metadata, ...transformed.globals };
    }
  }

  // If packageType is explicitly provided (even as undefined), use that value
  let finalPackageType: 'module' | 'commonjs' | undefined;
  if ('packageType' in config) {
    finalPackageType = packageType;
  } else {
    finalPackageType = !Object.keys(frameworkFiles).length ? 'module' : undefined;
  }

  // Get existing extraFiles and source filename
  const sourceFilename = getFilenameFromVariant(processedVariantCode);

  // Get path context to understand navigation
  const pathContext = createPathContext(variantCode); // Determine if we need to rename the source file (if it's index.tsx in src dir)

  const ext = useTypescript ? 'tsx' : 'jsx';
  const isSourceFileIndex = sourceFilename === `index.${ext}`;
  // Use urlDirectory to determine if it's in src root (should only have 'src' as the directory)
  const isInSrcRoot = pathContext.urlDirectory.length <= 1;

  let actualSourceFilename = sourceFilename;

  // Use urlDirectory to construct the full path from src root
  const directoryPath = pathContext.urlDirectory.slice(1).join('/'); // Remove 'src' and join the rest
  let actualRootFile = directoryPath
    ? `${sourcePrefix}${directoryPath}/${sourceFilename}`
    : `${sourcePrefix}${sourceFilename}`;

  // If the source file is index.tsx and it's in the src root, we need to rename it
  if (isSourceFileIndex && isInSrcRoot) {
    actualSourceFilename = generateEntrypointFilename(
      processedVariantCode.extraFiles || {},
      sourceFilename,
      useTypescript,
    );
    actualRootFile = `${sourcePrefix}${actualSourceFilename}`;
  }

  // The main entrypoint is always src/index.tsx (or .jsx)
  const mainEntrypointFilename = `index.${ext}`;
  const entrypoint = `${sourcePrefix}${mainEntrypointFilename}`;

  // Get relative import path for the main component
  let importPath: string;
  if (isInSrcRoot) {
    // Component is in src root - import directly
    importPath = getRelativeImportPath(actualSourceFilename);
  } else {
    // Component is in a subdirectory - import with full path from src root
    const componentPath = directoryPath
      ? `${directoryPath}/${actualSourceFilename}`
      : actualSourceFilename;
    importPath = `./${(componentPath || '').replace(/\.[^.]*$/, '')}`; // Remove extension
  }

  // Strip /index from the end of import paths since module resolution handles it automatically
  if (importPath.endsWith('/index')) {
    importPath = importPath.slice(0, -6); // Remove '/index'
  }

  const importString = processedVariantCode.namedExport
    ? `import { ${processedVariantCode.namedExport} as App } from '${importPath}';`
    : `import App from '${importPath}';`;

  // Collect all files that will be generated
  const generatedFiles: VariantExtraFiles = {};

  // Update the variant's fileName if we renamed it
  if (
    isSourceFileIndex &&
    isInSrcRoot &&
    actualSourceFilename &&
    actualSourceFilename !== sourceFilename
  ) {
    processedVariantCode.fileName = actualSourceFilename;
  }

  // Check if they're providing their own framework
  const isFramework = 'frameworkFiles' in config;

  const externalPackages = externalsToPackages(processedVariantCode.externals || []);
  const variantDeps = Object.keys(externalPackages).reduce(
    (acc, pkg) => {
      // Check if we have a specific version for this package first
      if (versions[pkg]) {
        acc[pkg] = versions[pkg];
      } else if (resolveDependencies) {
        const resolvedDeps = resolveDependencies(pkg);
        Object.assign(acc, resolvedDeps);
      } else {
        // Simple fallback: just use 'latest' for each package
        acc[pkg] = 'latest';
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  // Collect metadata files to be generated
  const metadataFiles: VariantExtraFiles = {};

  // Generate package.json
  const packageJson = {
    private: true,
    name: finalTitle.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    version: '0.0.0',
    description: finalDescription,
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
      react: versions.react || 'latest',
      'react-dom': versions['react-dom'] || 'latest',
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
        '@types/react': versions['@types/react'] || 'latest',
        '@types/react-dom': versions['@types/react-dom'] || 'latest',
      }),
      ...devDependencies,
    },
    ...packageJsonFields,
  };

  metadataFiles['package.json'] = {
    source: JSON.stringify(packageJson, null, 2),
  };

  // Generate entrypoint and HTML files unless framework handles them
  if (!frameworkHandlesEntrypoint) {
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

    generatedFiles[mainEntrypointFilename] = {
      source: entrypointContent,
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

    metadataFiles[`vite.config.${useTypescript ? 'ts' : 'js'}`] = {
      source: viteConfigContent,
    };
  }

  // Add TypeScript configuration if requested
  if (useTypescript) {
    // Check if frameworkFiles already includes a tsconfig
    const hasFrameworkTsConfig =
      frameworkFiles?.globals &&
      Object.keys(frameworkFiles.globals).some(
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

      metadataFiles['tsconfig.json'] = {
        source: JSON.stringify(defaultTsConfig, null, 2),
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

      metadataFiles['tsconfig.node.json'] = {
        source: JSON.stringify(nodeTsConfig, null, 2),
      };
    }
  }

  // Generate HTML file after all files are ready
  if (!frameworkHandlesEntrypoint) {
    // Add index.html
    const headContent = headTemplate
      ? headTemplate({
          sourcePrefix,
          assetPrefix,
          variant: processedVariantCode,
          variantName,
        })
      : undefined;

    const htmlContent = htmlTemplate
      ? htmlTemplate({
          language,
          title: finalTitle,
          description: finalDescription,
          head: headContent,
          entrypoint,
          variant: processedVariantCode,
          variantName,
        })
      : defaultHtmlTemplate({
          language,
          title: finalTitle,
          description: finalDescription,
          head: headContent,
          entrypoint,
        });

    const htmlFileName = htmlPrefix ? `${htmlPrefix}index.html` : 'index.html';
    metadataFiles[htmlFileName] = {
      source: htmlContent,
    };
  }

  // Merge all metadata files including framework metadata and globals
  const allMetadataFiles = mergeFiles(
    processedGlobals || {},
    metadataFiles,
    extraMetadataFiles,
    frameworkFiles.globals || {},
  );

  // Merge all files using mergeMetadata to properly position everything with 'src/' (sourcePrefix opt) prefix
  const allSourceFilesWithFramework = mergeFiles(
    processedVariantCode.extraFiles || {},
    generatedFiles,
    frameworkFiles.variant?.extraFiles || {},
  );

  // Update the variant with all source files including framework source files
  const finalVariantWithSources: VariantCode = {
    ...processedVariantCode,
    extraFiles: allSourceFilesWithFramework,
  };

  // Use mergeMetadata to position everything correctly
  const finalVariant = mergeMetadata(finalVariantWithSources, allMetadataFiles, {
    metadataPrefix: sourcePrefix,
  });

  // Return new VariantCode with properly positioned files
  return {
    exported: finalVariant,
    rootFile: actualRootFile,
  };
}
