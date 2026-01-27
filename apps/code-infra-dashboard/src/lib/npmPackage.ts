import { useQuery } from '@tanstack/react-query';
import * as pako from 'pako';
import * as semver from 'semver';

export interface FileContent {
  path: string;
  content: string;
}

export interface PackageContents {
  name: string;
  version: string;
  files: FileContent[];
}

export interface ResolvedPackage {
  downloadUrl: string;
  name: string;
  version: string;
}

function isUrl(str: string): boolean {
  try {
    return !!new URL(str);
  } catch {
    return false;
  }
}

export async function resolvePackageDownloadUrl(packageSpec: string): Promise<ResolvedPackage> {
  // Case 1: Direct URL
  if (isUrl(packageSpec)) {
    return {
      downloadUrl: packageSpec,
      name: packageSpec,
      version: packageSpec,
    };
  }

  // Parse package name and version
  let packageName: string;
  let versionSpec: string | undefined;

  const atIndex = packageSpec.indexOf('@', 1);

  if (atIndex === -1) {
    packageName = packageSpec;
  } else {
    packageName = packageSpec.substring(0, atIndex);
    versionSpec = packageSpec.substring(atIndex + 1);
  }

  // Case 2: No version specified - use latest
  if (!versionSpec) {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
    if (!response.ok) {
      throw new Error(`Package not found: ${packageName}`);
    }
    const packageInfo = await response.json();
    return {
      downloadUrl: packageInfo.dist.tarball,
      name: packageInfo.name,
      version: packageInfo.version,
    };
  }

  // Check if version is exact (no semver operators)
  const isExactVersion = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(
    versionSpec,
  );

  // Case 3: Exact version
  if (isExactVersion) {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/${versionSpec}`);
    if (!response.ok) {
      throw new Error(`Version not found: ${packageName}@${versionSpec}`);
    }
    const packageInfo = await response.json();
    return {
      downloadUrl: packageInfo.dist.tarball,
      name: packageInfo.name,
      version: packageInfo.version,
    };
  }

  // Case 4: Version range or partial version - resolve using semver
  const response = await fetch(`https://registry.npmjs.org/${packageName}`);
  if (!response.ok) {
    throw new Error(`Package not found: ${packageName}`);
  }

  const packageInfo = await response.json();
  const availableVersions = Object.keys(packageInfo.versions);

  // Find the best matching version
  const resolvedVersion = semver.maxSatisfying(availableVersions, versionSpec);

  if (!resolvedVersion) {
    throw new Error(`No version found matching ${versionSpec} for package ${packageName}`);
  }

  const versionInfo = packageInfo.versions[resolvedVersion];
  return {
    downloadUrl: versionInfo.dist.tarball,
    name: versionInfo.name,
    version: versionInfo.version,
  };
}

export async function extractTarGz(buffer: ArrayBuffer): Promise<FileContent[]> {
  const uint8Array = new Uint8Array(buffer);
  const decompressed = pako.ungzip(uint8Array);

  const files: FileContent[] = [];
  let offset = 0;

  while (offset < decompressed.length) {
    if (offset + 512 > decompressed.length) {
      break;
    }

    const header = decompressed.slice(offset, offset + 512);
    const nameBytes = header.slice(0, 100);
    const sizeBytes = header.slice(124, 136);

    const name = new TextDecoder().decode(nameBytes).split('\0')[0];
    const sizeStr = new TextDecoder().decode(sizeBytes).split('\0')[0];
    const size = parseInt(sizeStr.trim(), 8);

    if (!name || Number.isNaN(size)) {
      offset += 512;
      continue;
    }

    offset += 512;

    if (size > 0) {
      const content = decompressed.slice(offset, offset + size);
      const contentStr = new TextDecoder().decode(content);

      const cleanPath = name.replace(/^[^/]*\//, '');
      if (cleanPath && !cleanPath.endsWith('/')) {
        files.push({
          path: cleanPath,
          content: contentStr,
        });
      }

      offset += Math.ceil(size / 512) * 512;
    }
  }

  return files;
}

async function downloadAndExtractPackage(spec: string): Promise<PackageContents> {
  const resolvedPackage = await resolvePackageDownloadUrl(spec);

  const response = await fetch(resolvedPackage.downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download package: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const files = await extractTarGz(buffer);

  // Extract name and version from package.json in the tarball
  const packageJsonFile = files.find((f) => f.path === 'package.json');

  if (!packageJsonFile) {
    throw new Error(`package.json not found in the tarball`);
  }

  let packageJson: { name?: string; version?: string };
  try {
    packageJson = JSON.parse(packageJsonFile.content);
  } catch {
    throw new Error(`Failed to parse package.json from tarball`);
  }

  const packageName = packageJson.name || resolvedPackage.name;
  const packageVersion = packageJson.version || resolvedPackage.version;

  return {
    name: packageName,
    version: isUrl(resolvedPackage.version) ? resolvedPackage.version : packageVersion,
    files,
  };
}

export function usePackageContent(packageSpec: string | null) {
  return useQuery({
    queryKey: ['package-download', packageSpec],
    queryFn: () => downloadAndExtractPackage(packageSpec!),
    enabled: Boolean(packageSpec?.trim()),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
