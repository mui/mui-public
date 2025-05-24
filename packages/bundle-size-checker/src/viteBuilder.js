import path from 'path';
import fs from 'fs/promises';
import { gzipSync } from 'zlib';
import { build, transformWithEsbuild } from 'vite';
import { byteSizeFormatter } from './formatUtils.js';

const rootDir = process.cwd();

/**
 * Creates vite configuration for bundle size checking
 * @param {ObjectEntry} entry - Entry point (string or object)
 * @param {CommandLineArgs} args
 * @returns {Promise<{configuration: import('vite').InlineConfig, externalsArray: string[]}>}
 */
async function createViteConfig(entry, args) {
  const entryName = entry.id;
  let entryContent;

  if (entry.code && (entry.import || entry.importedNames)) {
    entryContent = entry.code;
  } else if (entry.code) {
    entryContent = entry.code;
  } else if (entry.import) {
    if (entry.importedNames && entry.importedNames.length > 0) {
      // Generate named imports for each name in the importedNames array
      const imports = entry.importedNames
        .map((name) => `import { ${name} } from '${entry.import}';`)
        .join('\n');
      const logs = entry.importedNames.map((name) => `console.log(${name});`).join('\n');
      entryContent = `${imports}\n${logs}`;
    } else {
      // Default to import * as if importedNames is not defined
      entryContent = `import * as _ from '${entry.import}';\nconsole.log(_);`;
    }
  } else {
    throw new Error(`Entry "${entry.id}" must have either code or import property defined`);
  }

  // Use externals from the entry object
  const externalsArray = entry.externals || ['react', 'react-dom'];

  // Ensure build directory exists
  const outDir = path.join(rootDir, 'build', entryName);
  await fs.mkdir(outDir, { recursive: true });

  /**
   * @type {import('vite').InlineConfig}
   */
  const configuration = {
    configFile: false,
    build: {
      write: true,
      minify: true,
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: '/index.tsx',
        external: externalsArray,
      },
      manifest: true,
      reportCompressedSize: true,
      target: 'esnext',
    },

    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
    logLevel: args.verbose ? 'info' : 'silent',
    // Add plugins to handle virtual entry points
    plugins: [
      {
        name: 'virtual-entry',
        resolveId(id) {
          if (id === '/index.tsx') {
            return `\0virtual:index.tsx`;
          }
          if (id === '/entry.tsx') {
            return `\0virtual:entry.tsx`;
          }
          return null;
        },
        load(id) {
          if (id === `\0virtual:index.tsx`) {
            return transformWithEsbuild(`import foo from '/entry.tsx';console.log(foo)`, id);
          }
          if (id === `\0virtual:entry.tsx`) {
            return transformWithEsbuild(entryContent, id);
          }
          return null;
        },
      },
    ],
  };

  return { configuration, externalsArray };
}

/**
 * Process vite output to extract bundle sizes
 * @param {string} outDir - The output directory
 * @param {string} entryName - The entry name
 * @param {CommandLineArgs} args - Command line arguments
 * @returns {Promise<Map<string, { parsed: number, gzip: number }>>} - Map of bundle names to size information
 */
async function processBundleSizes(outDir, entryName, args) {
  /** @type {Map<string, { parsed: number, gzip: number }>} */
  const sizeMap = new Map();

  try {
    // Read the manifest file to find the generated chunks
    const manifestPath = path.join(outDir, '.vite/manifest.json');
    const manifestContent = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // Find the main entry point JS file in the manifest
    const mainEntry = Object.values(manifest).find(
      (entry) =>
        // It could be the entry JS file or one of the assets referenced from the HTML
        (entry.isEntry || entry.isDynamicEntry) && entry.file.endsWith('.js'),
    );

    let filePath;

    if (mainEntry) {
      // Get the file path from the manifest
      filePath = path.join(outDir, mainEntry.file);
    } else {
      // Fallback: try to find a JS file directly
      const files = await fs.readdir(outDir);
      const jsFile = files.find((file) => file.endsWith('.js') && !file.includes('-'));

      if (!jsFile) {
        throw new Error(`Could not find any JS files in ${outDir}`);
      }

      filePath = path.join(outDir, jsFile);
    }

    // Check if the file exists
    try {
      await fs.access(filePath);
    } catch (err) {
      throw new Error(`Found entry point in manifest but file does not exist: ${filePath}`);
    }
    const fileContent = await fs.readFile(filePath, 'utf8');

    // Calculate sizes
    const parsed = Buffer.byteLength(fileContent);
    const gzip = Buffer.byteLength(gzipSync(fileContent));

    sizeMap.set(entryName, { parsed, gzip });

    // If analyze is requested, create a simple HTML report
    if (args.analyze) {
      const reportPath = path.join(rootDir, 'build', `${entryName}.html`);

      const reportContent = `
        <html>
          <head>
            <title>Bundle Size Analysis: ${entryName}</title>
            <style>
              body { font-family: sans-serif; }
              .size-info { margin: 20px 0; padding: 10px; background: #f5f5f5; border-radius: 4px; }
              .file-list { margin-top: 20px; }
              table { border-collapse: collapse; width: 100%; }
              th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
              th { background-color: #f2f2f2; }
            </style>
          </head>
          <body>
            <h1>Bundle Size Analysis: ${entryName}</h1>
            <div class="size-info">
              <p>Raw Size: ${byteSizeFormatter.format(parsed)}</p>
              <p>Gzipped Size: ${byteSizeFormatter.format(gzip)}</p>
            </div>
            <div class="details">
              TODO: Visualize details here
            </div>
          </body>
        </html>
      `;

      await fs.writeFile(reportPath, reportContent);
    }
  } catch (error) {
    console.error(`Error processing bundle sizes for ${entryName}:`, error);
    throw error;
  }

  return sizeMap;
}

/**
 * Get sizes for a vite bundle
 * @param {ObjectEntry} entry - The entry configuration
 * @param {CommandLineArgs} args - Command line arguments
 * @returns {Promise<Map<string, { parsed: number, gzip: number }>>}
 */
export async function getViteSizes(entry, args) {
  // Create vite configuration
  const { configuration } = await createViteConfig(entry, args);
  const outDir = path.join(rootDir, 'build', entry.id);

  try {
    // Run vite build
    await build(configuration);

    // Process the output to get bundle sizes
    return processBundleSizes(outDir, entry.id, args);
  } catch (error) {
    console.error(`Error building ${entry.id} with vite:`, error);
    throw error;
  }
}
