import type { BundlerConfig } from '../types';
import type { BinField, ExportConditions, ResolvedEntry } from './resolve-entrypoints';

/**
 * Output chunk from the bundler
 */
export interface OutputChunk {
  /** Name of the output (matches entry key). May end with .d for type definitions */
  name: string;
  /** Output file path */
  outputFile: string;
  /** Output format */
  format: 'esm' | 'cjs';
}

/**
 * Result of generating exports field
 */
export interface GeneratedExports {
  exports: Record<string, ExportConditions> | {};
  bin: BinField;
}

/**
 * Convert originalKey back to exports path format
 * originalKey is typically "." or "./something"
 */
function getExportPath(originalKey: string): string {
  if (originalKey === '.' || originalKey === 'index') {
    return '.';
  }
  if (originalKey.startsWith('./')) {
    return originalKey;
  }
  return `./${originalKey}`;
}

/**
 * Generate package.json exports and bin fields from bundler output chunks and entry configuration.
 *
 * This function takes the output chunks from a bundler (like tsdown) and the resolved
 * entry points from package.json, and generates the appropriate exports field structure
 * with proper conditions for ESM/CJS and their corresponding type definitions.
 *
 * @param outputs - Array of output chunks from the bundler
 * @param pkgEntries - Map of entry keys to resolved entry configurations
 * @returns Object containing the generated exports and bin fields
 *
 * @example
 * ```ts
 * const outputs = [
 *   { name: 'index', outputFile: 'index.mjs', format: 'esm' },
 *   { name: 'index', outputFile: 'index.cjs', format: 'cjs' },
 *   { name: 'index.d', outputFile: 'index.d.mts', format: 'esm' },
 *   { name: 'index.d', outputFile: 'index.d.cts', format: 'cjs' },
 * ];
 *
 * const entries = new Map([
 *   ['index', { exportKey: 'index', source: 'src/index.ts', platform: 'neutral', originalKey: '.' }],
 * ]);
 *
 * const result = generateExportsField(outputs, entries);
 * // {
 * //   exports: {
 * //     '.': {
 * //       import: { types: './index.d.mts', default: './index.mjs' },
 * //       require: { types: './index.d.cts', default: './index.cjs' },
 * //     }
 * //   },
 * //   bin: {}
 * // }
 * ```
 */
export function generateExportsField(
  outputs: OutputChunk[],
  pkgEntries: BundlerConfig['entries'],
): GeneratedExports {
  const exports: Record<string, ExportConditions> = {};
  const bin: Record<string, string> = {};

  // Group outputs by their name for lookup (entry key matches output name)
  const outputsByName = new Map<string, OutputChunk[]>();
  for (const output of outputs) {
    const existing = outputsByName.get(output.name) || [];
    existing.push(output);
    outputsByName.set(output.name, existing);
  }

  // Process each entry from pkgEntries
  for (const [entryKey, entry] of Array.from(pkgEntries.entries())) {
    // Look up outputs by entry key (name) since multiple entries can share the same source file
    const entryOutputs = outputsByName.get(entryKey);
    if (!entryOutputs || entryOutputs.length === 0) {
      continue;
    }

    // Handle bin entries
    if (entry.isBin) {
      const esmOutput = entryOutputs.find((o) => o.format === 'esm');
      const cjsOutput = entryOutputs.find((o) => o.format === 'cjs');
      const binOutput = esmOutput || cjsOutput;
      if (binOutput && entry.binName) {
        bin[entry.binName] = `./${binOutput.outputFile}`;
      } else if (binOutput) {
        // Single bin entry (string form, use the first key or default)
        bin[entry.exportKey.replace('bin/', '')] = `./${binOutput.outputFile}`;
      }
      continue;
    }

    // Find ESM and CJS outputs (by entry key/name)
    const esmOutput = entryOutputs.find((o) => o.format === 'esm');
    const cjsOutput = entryOutputs.find((o) => o.format === 'cjs');

    // Find corresponding .d.ts output (bundlers name type outputs as {entryKey}.d)
    const dtsOutputs = outputsByName.get(`${entryKey}.d`);
    const esmDtsOutput = dtsOutputs?.find((o) => o.format === 'esm');
    const cjsDtsOutput = dtsOutputs?.find((o) => o.format === 'cjs');

    // Determine the export key path (e.g., ".", "./utils")
    const exportPath = getExportPath(entry.originalKey);

    // Build the condition object for this entry
    // Structure: { import: { types, default }, require: { types, default } }
    const conditionObj: ExportConditions = {};

    // Add import (ESM) condition with its types
    if (esmOutput) {
      if (esmDtsOutput) {
        conditionObj.import = {
          types: `./${esmDtsOutput.outputFile}`,
          default: `./${esmOutput.outputFile}`,
        };
      } else {
        conditionObj.import = `./${esmOutput.outputFile}`;
      }
    }

    // Add require (CJS) condition with its types
    if (cjsOutput) {
      if (cjsDtsOutput) {
        conditionObj.require = {
          types: `./${cjsDtsOutput.outputFile}`,
          default: `./${cjsOutput.outputFile}`,
        };
      } else {
        conditionObj.require = `./${cjsOutput.outputFile}`;
      }
    }

    // Handle condition-specific entries (like react-server, node, browser)
    if (entry.condition && entry.condition !== 'default') {
      // Nest under the condition
      const existing = exports[exportPath] || {};
      existing[entry.condition] = conditionObj;
      exports[exportPath] = existing;
    } else {
      // Merge with existing entry if any
      const existing = exports[exportPath] || {};
      Object.assign(existing, conditionObj);
      exports[exportPath] = existing;
    }
  }

  // Convert bin to proper format
  let binField: BinField = {};
  if (Object.keys(bin).length === 1 && bin.bin) {
    binField = bin.bin;
  } else if (Object.keys(bin).length > 0) {
    binField = bin;
  }

  return {
    exports: Object.keys(exports).length > 0 ? exports : {},
    bin: binField,
  };
}

/**
 * Create a Map of entries from an array of ResolvedEntry objects.
 * Useful for testing when you need to create the entries Map.
 */
export function createEntriesMap(entries: ResolvedEntry[]): Map<string, ResolvedEntry> {
  const map = new Map<string, ResolvedEntry>();
  for (const entry of entries) {
    map.set(entry.exportKey, entry);
  }
  return map;
}
