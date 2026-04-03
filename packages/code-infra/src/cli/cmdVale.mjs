/* eslint-disable no-console */
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

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
  await new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`tar exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Extracts a .zip archive to a destination directory using the built-in unzip command.
 * @param {string} archivePath
 * @param {string} destDir
 * @returns {Promise<void>}
 */
async function extractZip(archivePath, destDir) {
  await new Promise((resolve, reject) => {
    const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`unzip exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Returns the path to the vale binary, downloading it first if necessary.
 * The binary is cached under `<workspaceRoot>/node_modules/.cache/vale/<version>/`.
 * @param {string} workspaceDir
 * @param {string} version
 * @returns {Promise<string>}
 */
async function getValeBinaryPath(workspaceDir, version) {
  const valeOS = detectOS();
  const valeArch = detectArch();
  const { filename, isZip } = getArchiveInfo(version, valeOS, valeArch);

  const binaryName = valeOS === 'Windows' ? 'vale.exe' : 'vale';
  const cacheDir = path.join(workspaceDir, 'node_modules', '.cache', 'vale', version);
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
  await new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, valeArgs, { stdio: 'inherit' });
    proc.on('close', (code) => {
      process.exitCode = code ?? 0;
      resolve(undefined);
    });
    proc.on('error', reject);
  });
}

/**
 * @typedef {{ 'vale-version': string; valeVersion: string }} Args
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'vale',
  describe:
    'Download and run vale (a prose linter). All arguments are forwarded to the vale binary.',
  builder: (yargs) => {
    return yargs
      .option('vale-version', {
        type: 'string',
        default: DEFAULT_VALE_VERSION,
        description:
          'Vale version to download and run. Pass "latest" to fetch the latest release from GitHub.',
      })
      .example('$0 vale --help', 'Show vale help')
      .example('$0 vale --vale-version latest sync', 'Sync vale styles using the latest version')
      .example('$0 vale --vale-version 3.14.0 sync', 'Sync vale styles using a specific version')
      .example('$0 vale docs/', 'Lint all files in the docs/ directory')
      .strict(false);
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const workspaceDir = await findWorkspaceDir(cwd);
    if (!workspaceDir) {
      throw new Error('Workspace directory not found. Make sure you are inside a pnpm workspace.');
    }

    const version =
      args.valeVersion === 'latest'
        ? await fetchLatestVersion()
        : (args.valeVersion ?? DEFAULT_VALE_VERSION);
    const binaryPath = await getValeBinaryPath(workspaceDir, version);

    // Collect everything from process.argv that follows the "vale" token,
    // excluding our own --vale-version flag and its value.
    const argvAfterVale = process.argv.slice(process.argv.indexOf('vale') + 1);
    const valeArgs = [];
    for (let i = 0; i < argvAfterVale.length; i += 1) {
      const arg = argvAfterVale[i];
      if (arg === '--vale-version') {
        i += 1; // skip the following value too
      } else if (arg.startsWith('--vale-version=')) {
        // no-op, value is embedded
      } else {
        valeArgs.push(arg);
      }
    }

    await runVale(binaryPath, valeArgs);
  },
});
