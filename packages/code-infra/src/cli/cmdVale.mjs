/* eslint-disable no-console */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { $ } from 'execa';
import { mapConcurrently } from '../utils/build.mjs';

const DEFAULT_VALE_VERSION = '3.14.1';
const LATEST_RELEASE_URL = 'https://api.github.com/repos/vale-cli/vale/releases/latest';

/**
 * Fetches the latest vale release version tag from GitHub.
 * @returns {Promise<string>}
 */
async function fetchLatestVersion() {
  const response = await fetchOrThrow(LATEST_RELEASE_URL);
  const data = /** @type {{ tag_name: string }} */ (await response.json());
  // tag_name is like "v3.14.1", strip the leading "v"
  return data.tag_name.replace(/^v/, '');
}

/**
 * @typedef {'Linux' | 'macOS' | 'Windows'} ValeOS
 * @typedef {'64-bit' | 'arm64'} ValeArch
 */

/**
 * Detects the OS name used in vale release filenames.
 * @returns {ValeOS}
 */
function detectOS() {
  const platform = os.platform();
  if (platform === 'linux') {
    return 'Linux';
  }
  if (platform === 'darwin') {
    return 'macOS';
  }
  if (platform === 'win32') {
    return 'Windows';
  }
  throw new Error(
    `Unsupported platform: ${platform}. Vale only supports Linux, macOS, and Windows.`,
  );
}

/**
 * Detects the CPU architecture used in vale release filenames.
 * Exits with an error for 32-bit systems.
 * @returns {ValeArch}
 */
function detectArch() {
  const arch = os.arch();
  if (arch === 'arm64') {
    return 'arm64';
  }
  if (arch === 'x64') {
    return '64-bit';
  }
  throw new Error(
    `Unsupported architecture: ${arch}. Vale requires a 64-bit system (x64 or arm64).`,
  );
}

/**
 * Returns the archive filename for the current platform.
 * @param {ValeOS} valeOS
 * @param {ValeArch} valeArch
 * @returns {{ filename: string; isZip: boolean }}
 */
/**
 * Returns the base GitHub release download URL for a given vale version.
 * @param {string} version
 * @returns {string}
 */
function getReleasesBase(version) {
  return `https://github.com/vale-cli/vale/releases/download/v${version}`;
}

/**
 * Returns the archive filename for the current platform.
 * @param {string} version
 * @param {ValeOS} valeOS
 * @param {ValeArch} valeArch
 * @returns {{ filename: string; isZip: boolean }}
 */
function getArchiveInfo(version, valeOS, valeArch) {
  const isZip = valeOS === 'Windows';
  const ext = isZip ? '.zip' : '.tar.gz';
  const filename = `vale_${version}_${valeOS}_${valeArch}${ext}`;
  return { filename, isZip };
}

/**
 * Fetches a URL and returns the Response, throwing on non-OK status.
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchOrThrow(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response;
}

/**
 * Downloads the checksums file and parses it into a map of filename -> sha256 hex.
 * @param {string} version
 * @returns {Promise<Map<string, string>>}
 */
async function fetchChecksums(version) {
  const checksumsUrl = `${getReleasesBase(version)}/vale_${version}_checksums.txt`;
  const response = await fetchOrThrow(checksumsUrl);
  const text = await response.text();
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const line of text.trim().split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (hash && name) {
      map.set(name, hash);
    }
  }
  return map;
}

/**
 * Computes the SHA-256 hex digest of a file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fileHandle = await fs.open(filePath, 'r');
  const stream = fileHandle.createReadStream();
  await pipeline(stream, hash);
  return hash.digest('hex');
}

/**
 * Downloads a URL to a local file path, showing progress.
 * @param {string} url
 * @param {string} destPath
 * @param {string} version
 * @returns {Promise<void>}
 */
async function downloadFile(url, destPath, version) {
  const response = await fetchOrThrow(url);
  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let downloadedBytes = 0;

  if (!response.body) {
    throw new Error(`No response body for ${url}`);
  }

  const writeStream = createWriteStream(destPath);

  // Pipe the web ReadableStream into a Node.js WriteStream, tracking progress
  const nodeReadable = /** @type {import('node:stream').Readable} */ (
    /** @type {unknown} */ (response.body)
  );

  await pipeline(
    nodeReadable,
    async function* trackProgress(source) {
      for await (const chunk of source) {
        const bytes = /** @type {Buffer} */ (chunk);
        downloadedBytes += bytes.length;
        if (totalBytes > 0) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\rDownloading vale v${version}... ${pct}%`);
        }
        yield bytes;
      }
    },
    writeStream,
  );

  if (totalBytes > 0) {
    process.stdout.write('\n');
  }
}

/**
 * Extracts a .tar.gz archive to a destination directory using the built-in tar command.
 * @param {string} archivePath
 * @param {string} destDir
 * @returns {Promise<void>}
 */
async function extractTarGz(archivePath, destDir) {
  await $({ stdio: 'inherit' })`tar -xzf ${archivePath} -C ${destDir}`;
}

/**
 * Extracts a .zip archive to a destination directory using the built-in unzip command.
 * @param {string} archivePath
 * @param {string} destDir
 * @returns {Promise<void>}
 */
async function extractZip(archivePath, destDir) {
  await $({ stdio: 'inherit' })`unzip -o ${archivePath} -d ${destDir}`;
}

/**
 * Returns the path to the vale binary, downloading it first if necessary.
 * The binary is cached under `~/.cache/mui-vale/<version>/`.
 * @param {string} version
 * @returns {Promise<string>}
 */
async function getValeBinaryPath(version) {
  const valeOS = detectOS();
  const valeArch = detectArch();
  const { filename, isZip } = getArchiveInfo(version, valeOS, valeArch);

  const binaryName = valeOS === 'Windows' ? 'vale.exe' : 'vale';
  const cacheDir = path.join(os.homedir(), '.cache', 'mui-vale', version);
  const binaryPath = path.join(cacheDir, binaryName);

  // Return cached binary if it already exists
  const binaryExists = await fs
    .stat(binaryPath)
    .then((s) => s.isFile())
    .catch(() => false);
  if (binaryExists) {
    return binaryPath;
  }

  console.log(`Vale v${version} not found in cache. Downloading...`);

  // Fetch checksums first
  const checksums = await fetchChecksums(version);
  const expectedChecksum = checksums.get(filename);
  if (!expectedChecksum) {
    throw new Error(`No checksum found for ${filename} in checksums file.`);
  }

  await fs.mkdir(cacheDir, { recursive: true });

  const archivePath = path.join(cacheDir, filename);

  try {
    const downloadUrl = `${getReleasesBase(version)}/${filename}`;
    await downloadFile(downloadUrl, archivePath, version);

    // Verify checksum
    console.log('Verifying checksum...');
    const actualChecksum = await sha256File(archivePath);
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Checksum mismatch for ${filename}.\n  Expected: ${expectedChecksum}\n  Got:      ${actualChecksum}`,
      );
    }
    console.log('Checksum verified.');

    // Extract archive
    console.log(`Extracting ${filename}...`);
    if (isZip) {
      await extractZip(archivePath, cacheDir);
    } else {
      await extractTarGz(archivePath, cacheDir);
    }

    // Make the binary executable on Unix
    if (valeOS !== 'Windows') {
      await fs.chmod(binaryPath, 0o755);
    }

    console.log(`Vale v${version} ready at ${binaryPath}`);
  } finally {
    // Clean up the downloaded archive regardless of success or failure
    await fs.rm(archivePath, { force: true });
  }

  return binaryPath;
}

/**
 * Runs the vale binary, forwarding all extra args and inheriting stdio.
 * @param {string} binaryPath
 * @param {string[]} valeArgs
 * @returns {Promise<void>}
 */
async function runVale(binaryPath, valeArgs) {
  const result = await $({ stdio: 'inherit', reject: false })`${binaryPath} ${valeArgs}`;
  process.exitCode = result.exitCode;
}

/**
 * Runs vale with JSON output and captures the results.
 * @param {string} binaryPath
 * @param {string[]} valeArgs
 * @returns {Promise<Record<string, Array<{ Action: { Name: string; Params: string[] | null }; Span: [number, number]; Check: string; Message: string; Severity: string; Match: string; Line: number }>>>}
 */
async function runValeJSON(binaryPath, valeArgs) {
  const result = await $({ reject: false })`${binaryPath} --output JSON ${valeArgs}`;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Failed to parse vale JSON output: ${result.stdout}`);
  }
}

/**
 * Extracts the replacement text from a vale alert.
 * Returns null if no replacement can be determined.
 * @param {{ Action: { Name: string; Params: string[] | null }; Message: string }} alert
 * @returns {string | null}
 */
export function getReplacementText(alert) {
  // If vale provides an explicit action with replacement params, use that
  if (alert.Action.Name === 'replace' && alert.Action.Params && alert.Action.Params.length > 0) {
    return alert.Action.Params[0];
  }

  // Otherwise, try to extract from the message pattern.
  // Vale messages follow patterns like:
  //   "Use 'X' instead of 'Y'"
  //   "Use the US spelling 'X' instead of the British 'Y'"
  //   "Use a non-breaking space ... ('X' instead of 'Y')"
  const match = alert.Message.match(/'([^']+)'\s+instead\s+of\s+.*?'([^']+)'/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Applies auto-fixes from vale alerts to the source files.
 * Processes alerts in reverse order within each line to preserve column positions.
 * @param {Record<string, Array<{ Action: { Name: string; Params: string[] | null }; Span: [number, number]; Check: string; Message: string; Severity: string; Match: string; Line: number }>>} results
 * @param {'all' | 'error'} fixLevel
 * @returns {Promise<{ fixed: number; skipped: number }>}
 */
export async function applyFixes(results, fixLevel) {
  const entries = Object.entries(results);

  const perFileResults = await mapConcurrently(
    entries,
    async ([filePath, alerts]) => {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Filter alerts by severity and whether we can determine a replacement
      const fixableAlerts = alerts.filter((alert) => {
        if (fixLevel === 'error' && alert.Severity !== 'error') {
          return false;
        }
        return getReplacementText(alert) !== null;
      });

      if (fixableAlerts.length === 0) {
        return { fixed: 0, skipped: alerts.length };
      }

      // Deduplicate alerts at the same location (same line + span), keeping the first one
      /** @type {Map<string, typeof fixableAlerts[0]>} */
      const uniqueAlerts = new Map();
      for (const alert of fixableAlerts) {
        const key = `${alert.Line}:${alert.Span[0]}:${alert.Span[1]}`;
        if (!uniqueAlerts.has(key)) {
          uniqueAlerts.set(key, alert);
        }
      }

      // Sort by line ascending, then by span start descending (so we apply right-to-left)
      const sortedAlerts = [...uniqueAlerts.values()].sort((a, b) => {
        if (a.Line !== b.Line) {
          return a.Line - b.Line;
        }
        return b.Span[0] - a.Span[0];
      });

      // Group alerts by line number
      /** @type {Map<number, typeof sortedAlerts>} */
      const alertsByLine = new Map();
      for (const alert of sortedAlerts) {
        const lineAlerts = alertsByLine.get(alert.Line) ?? [];
        lineAlerts.push(alert);
        alertsByLine.set(alert.Line, lineAlerts);
      }

      // Apply fixes line by line, right-to-left within each line
      let fileFixed = 0;
      for (const [lineNum, lineAlerts] of alertsByLine) {
        let line = lines[lineNum - 1]; // Line is 1-based
        for (const alert of lineAlerts) {
          const replacement = /** @type {string} */ (getReplacementText(alert));
          // Span is 1-based [start, end] inclusive
          const start = alert.Span[0] - 1;
          const end = alert.Span[1];
          line = line.slice(0, start) + replacement + line.slice(end);
          fileFixed += 1;
        }
        lines[lineNum - 1] = line;
      }

      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');

      return { fixed: fileFixed, skipped: alerts.length - fixableAlerts.length };
    },
    10,
  );

  let fixed = 0;
  let skipped = 0;
  for (const result of perFileResults) {
    if (result instanceof Error) {
      throw result;
    }
    fixed += result.fixed;
    skipped += result.skipped;
  }

  return { fixed, skipped };
}

/**
 * @typedef {{ 'vale-version': string; valeVersion: string; 'get-version': boolean; getVersion: boolean; 'auto-fix': 'all' | 'error' | undefined; autoFix: 'all' | 'error' | undefined }} Args
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'vale',
  describe:
    'Download and run vale (a prose linter). All arguments are forwarded to the vale binary.',
  builder: (yargs) => {
    return yargs
      .option('get-version', {
        type: 'boolean',
        default: false,
        description: 'Print the default vale version used by this script and exit.',
      })
      .option('auto-fix', {
        type: 'string',
        choices: ['all', 'error'],
        description:
          'Automatically apply fixes suggested by vale. "all" fixes both errors and warnings, "error" fixes only errors.',
      })
      .example('$0 vale --help', 'Show vale help')
      .example('$0 vale docs/', 'Lint all files in the docs/ directory')
      .example('$0 vale --auto-fix=all docs/', 'Lint and auto-fix all issues in docs/')
      .strict(false);
  },
  handler: async (args) => {
    if (args.getVersion) {
      console.log(DEFAULT_VALE_VERSION);
      return;
    }

    const version =
      args.valeVersion === 'latest'
        ? await fetchLatestVersion()
        : (args.valeVersion ?? DEFAULT_VALE_VERSION);
    const binaryPath = await getValeBinaryPath(version);

    // Collect everything from process.argv that follows the "vale" token,
    // excluding our own flags and their values.
    const argvAfterVale = process.argv.slice(process.argv.indexOf('vale') + 1);
    const valeArgs = [];
    for (let i = 0; i < argvAfterVale.length; i += 1) {
      const arg = argvAfterVale[i];
      if (arg === '--get-version') {
        // no-op, consumed by this wrapper
      } else if (arg === '--auto-fix' || arg.startsWith('--auto-fix=')) {
        // consumed by this wrapper; skip the next arg if it's the value
        if (
          arg === '--auto-fix' &&
          argvAfterVale[i + 1] &&
          !argvAfterVale[i + 1].startsWith('--')
        ) {
          i += 1;
        }
      } else {
        valeArgs.push(arg);
      }
    }

    if (args.autoFix) {
      const fixLevel = /** @type {'all' | 'error'} */ (args.autoFix);
      const results = await runValeJSON(binaryPath, valeArgs);
      const totalAlerts = Object.values(results).reduce((sum, alerts) => sum + alerts.length, 0);

      if (totalAlerts === 0) {
        console.log('No issues found by vale.');
        return;
      }

      const { fixed, skipped } = await applyFixes(results, fixLevel);
      console.log(`Auto-fix complete: ${fixed} fixed, ${skipped} skipped.`);

      if (fixed > 0) {
        // Re-run vale to show remaining issues
        console.log('\nRemaining issues after auto-fix:');
        await runVale(binaryPath, valeArgs);
      }
      return;
    }

    await runVale(binaryPath, valeArgs);
  },
});
