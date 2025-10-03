import path from 'node:path';
import fs from 'node:fs/promises';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import { build, transformWithEsbuild } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { escapeFilepathSegment } from './strings.js';

const gzipAsync = promisify(zlib.gzip);

const rootDir = process.cwd();

/**
 * @typedef {Object} ManifestChunk
 * @property {string} file - Hashed filename of the chunk
 * @property {string} [name] - Optional name of the chunk
 * @property {string} [src] - Original source path
 * @property {string[]} [css] - Associated CSS files
 * @property {boolean} [isEntry] - Indicates if this is an entry point
 * @property {boolean} [isDynamicEntry] - Indicates if this is a dynamic entry point
 * @property {string[]} [imports] - Imported chunk keys
 * @property {string[]} [dynamicImports] - Dynamically imported chunk keys
 */

/**
 * @typedef {Record<string, ManifestChunk>} Manifest
 */

/**
 * Creates a simple string replacement plugin
 * @param {Record<string, string>} replacements - Object with string replacements
 * @returns {import('vite').Plugin}
 */
function createReplacePlugin(replacements) {
  return {
    name: 'string-replace',
    transform(code) {
      let transformedCode = code;
      for (const [search, replace] of Object.entries(replacements)) {
        transformedCode = transformedCode.replaceAll(search, replace);
      }
      return transformedCode !== code ? transformedCode : null;
    },
  };
}

/**
 * Creates vite configuration for bundle size checking
 * @param {ObjectEntry} entry - Entry point (string or object)
 * @param {CommandLineArgs} args
 * @param {Record<string, string>} [replacements] - String replacements to apply
 * @returns {Promise<{ config:import('vite').InlineConfig, treemapPath: string }>}
 */
async function createViteConfig(entry, args, replacements = {}) {
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
  const outDir = path.join(rootDir, 'build', escapeFilepathSegment(entryName));
  await fs.mkdir(outDir, { recursive: true });

  const treemapPath = path.join(outDir, 'treemap.html');

  /**
   * @type {import('vite').InlineConfig}
   */
  const config = {
    configFile: false,
    root: rootDir,

    build: {
      write: true,
      minify: args.debug ? 'esbuild' : true,
      outDir,
      emptyOutDir: true,
      modulePreload: false,
      rollupOptions: {
        input: {
          ignore: '/ignore.ts',
          bundle: '/entry.tsx',
        },
        output: {
          // The output is for debugging purposes only. Remove all hashes to make it easier to compare two folders
          // of build output.
          entryFileNames: `assets/[name].js`,
          chunkFileNames: `assets/[name].js`,
          assetFileNames: `assets/[name].[ext]`,
        },
        external: (id) => externalsArray.some((ext) => id === ext || id.startsWith(`${ext}/`)),
        plugins: [
          ...(args.analyze
            ? [
                // File sizes are not accurate, use it only for relative comparison
                visualizer({
                  filename: treemapPath,
                  title: `Bundle Size Analysis: ${entryName}`,
                  projectRoot: rootDir,
                  open: false,
                  gzipSize: true,
                  brotliSize: false,
                  template: 'treemap',
                }),
              ]
            : []),
        ],
      },
      manifest: true,
      reportCompressedSize: true,
      target: 'esnext',
    },

    esbuild: {
      legalComments: 'none',
      ...(args.debug && {
        minifyIdentifiers: false,
        minifyWhitespace: false,
        minifySyntax: true, // This enables tree-shaking and other safe optimizations
      }),
    },

    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    logLevel: args.verbose ? 'info' : 'silent',
    // Add plugins to handle virtual entry points
    plugins: [
      createReplacePlugin(replacements),
      {
        name: 'virtual-entry',
        resolveId(id) {
          if (id === '/ignore.ts') {
            return `\0virtual:ignore.ts`;
          }
          if (id === '/entry.tsx') {
            return `\0virtual:entry.tsx`;
          }
          return null;
        },
        load(id) {
          if (id === `\0virtual:ignore.ts`) {
            // ignore chunk will contain the vite preload code, we can ignore this chunk in the output
            // See https://github.com/vitejs/vite/issues/18551
            return transformWithEsbuild(`import('/entry.tsx').then(console.log)`, id);
          }
          if (id === `\0virtual:entry.tsx`) {
            return transformWithEsbuild(entryContent, id);
          }
          return null;
        },
      },
    ],
  };

  return { config, treemapPath };
}

/**
 * Walks the dependency tree starting from a chunk and collects all dependencies
 * @param {string} chunkKey - The key of the chunk to start from
 * @param {Manifest} manifest - The Vite manifest
 * @param {Set<string>} visited - Set of already visited chunks to avoid cycles
 * @returns {Set<string>} - Set of all chunk keys in the dependency tree
 */
function walkDependencyTree(chunkKey, manifest, visited = new Set()) {
  if (visited.has(chunkKey)) {
    return visited;
  }

  visited.add(chunkKey);
  const chunk = manifest[chunkKey];

  if (!chunk) {
    throw new Error(`Chunk not found in manifest: ${chunkKey}`);
  }

  // Walk through static imports
  if (chunk.imports) {
    for (const importKey of chunk.imports) {
      walkDependencyTree(importKey, manifest, visited);
    }
  }

  // Walk through dynamic imports
  if (chunk.dynamicImports) {
    for (const dynamicImportKey of chunk.dynamicImports) {
      walkDependencyTree(dynamicImportKey, manifest, visited);
    }
  }

  return visited;
}

/**
 * Process vite output to extract bundle sizes
 * @param {import('vite').Rollup.RollupOutput['output']} output - The Vite output
 * @param {string} entryName - The entry name
 * @returns {Promise<Map<string, SizeSnapshotEntry>>} - Map of bundle names to size information
 */
async function processBundleSizes(output, entryName) {
  const chunksByFileName = new Map(output.map((chunk) => [chunk.fileName, chunk]));

  // Read the manifest file to find the generated chunks
  const manifestChunk = chunksByFileName.get('.vite/manifest.json');
  if (manifestChunk?.type !== 'asset') {
    throw new Error(`Manifest file not found in output for entry: ${entryName}`);
  }

  const manifestContent =
    typeof manifestChunk.source === 'string'
      ? manifestChunk.source
      : new TextDecoder().decode(manifestChunk.source);

  /** @type {Manifest} */
  const manifest = JSON.parse(manifestContent);

  // Find the main entry point JS file in the manifest
  const mainEntry = Object.entries(manifest).find(([_, entry]) => entry.name === 'bundle');

  if (!mainEntry) {
    throw new Error(`No main entry found in manifest for ${entryName}`);
  }

  // Walk the dependency tree to get all chunks that are part of this entry
  const allChunks = walkDependencyTree(mainEntry[0], manifest);

  // Process each chunk in the dependency tree in parallel
  const chunkPromises = Array.from(allChunks, async (chunkKey) => {
    const chunk = manifest[chunkKey];
    const outputChunk = chunksByFileName.get(chunk.file);
    if (outputChunk?.type !== 'chunk') {
      throw new Error(`Output chunk not found for ${chunk.file}`);
    }
    const fileContent = outputChunk.code;
    if (chunk.name === 'preload-helper') {
      // Skip the preload-helper chunk as it is not relevant for bundle size
      return null;
    }

    // Calculate sizes
    const parsed = Buffer.byteLength(fileContent);
    const gzipBuffer = await gzipAsync(fileContent, { level: zlib.constants.Z_BEST_COMPRESSION });
    const gzipSize = Buffer.byteLength(gzipBuffer);

    // Use chunk key as the name, or fallback to entry name for main chunk
    const chunkName = chunk.name === 'bundle' ? entryName : chunk.name || chunkKey;
    return /** @type {const} */ ([chunkName, { parsed, gzip: gzipSize }]);
  });

  const chunkEntries = await Promise.all(chunkPromises);
  return new Map(/** @type {[string, SizeSnapshotEntry][]} */ (chunkEntries.filter(Boolean)));
}

/**
 * Get sizes for a vite bundle
 * @param {ObjectEntry} entry - The entry configuration
 * @param {CommandLineArgs} args - Command line arguments
 * @param {Record<string, string>} [replacements] - String replacements to apply
 * @returns {Promise<{ sizes: Map<string, SizeSnapshotEntry>, treemapPath: string }>}
 */
export async function getBundleSizes(entry, args, replacements) {
  // Create vite configuration
  const { config, treemapPath } = await createViteConfig(entry, args, replacements);

  // Run vite build
  const { output } = /** @type {import('vite').Rollup.RollupOutput} */ (await build(config));
  const manifestChunk = output.find((chunk) => chunk.fileName === '.vite/manifest.json');
  if (!manifestChunk) {
    throw new Error(`Manifest file not found in output for entry: ${entry.id}`);
  }

  // Process the output to get bundle sizes
  const sizes = await processBundleSizes(output, entry.id);

  return { sizes, treemapPath };
}
