/// <reference types="./types.d.ts" />

import defineConfig from './defineConfig.js';
import { loadConfig } from './configLoader.js';
import { calculateSizeDiff } from './sizeDiff.js';
import { renderMarkdownReport } from './renderMarkdownReport.js';
import { fetchSnapshot } from './fetchSnapshot.js';

export { defineConfig, loadConfig, calculateSizeDiff, renderMarkdownReport, fetchSnapshot };

/**
 * @typedef {import('./sizeDiff.js').Size} Size
 * @typedef {import('./sizeDiff.js').SizeSnapshot} SizeSnapshot
 * @typedef {import('./sizeDiff.js').ComparisonResult} ComparisonResult
 */
