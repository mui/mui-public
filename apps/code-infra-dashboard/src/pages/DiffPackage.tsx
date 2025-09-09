import * as React from 'react';
import { useSearchParams } from 'react-router';
import { Container, Typography, Alert, Box, TextField, Button } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import * as diff from 'diff';
import * as pako from 'pako';
import * as semver from 'semver';

interface FileContent {
  path: string;
  content: string;
}

interface PackageContents {
  name: string;
  version: string;
  files: FileContent[];
}

interface ResolvedPackage {
  downloadUrl: string;
  name: string;
  version: string;
  resolvedVersion?: string;
}

async function resolvePackageDownloadUrl(packageSpec: string): Promise<ResolvedPackage> {
  // Case 1: Direct URL
  if (packageSpec.startsWith('http://') || packageSpec.startsWith('https://')) {
    return {
      downloadUrl: packageSpec,
      name: packageSpec,
      version: packageSpec,
      resolvedVersion: packageSpec,
    };
  }

  // Parse package name and version
  let packageName: string;
  let versionSpec: string | undefined;

  if (packageSpec.startsWith('@')) {
    // Scoped package: @scope/name@version
    const parts = packageSpec.split('@');
    if (parts.length === 2) {
      // @scope/name
      packageName = packageSpec;
    } else if (parts.length === 3) {
      // @scope/name@version
      packageName = `${parts[0]}@${parts[1]}`;
      versionSpec = parts[2];
    } else {
      throw new Error(`Invalid scoped package specification: ${packageSpec}`);
    }
  } else {
    // Regular package: name@version
    const atIndex = packageSpec.lastIndexOf('@');
    if (atIndex === -1) {
      // No version specified
      packageName = packageSpec;
    } else {
      packageName = packageSpec.substring(0, atIndex);
      versionSpec = packageSpec.substring(atIndex + 1);
    }
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

async function extractTarGz(buffer: ArrayBuffer): Promise<FileContent[]> {
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
  let packageName = resolvedPackage.name;
  let packageVersion = resolvedPackage.version;

  if (!packageJsonFile) {
    throw new Error(`package.json not found in the tarball`);
  }

  try {
    const packageJson = JSON.parse(packageJsonFile.content);
    packageName = packageJson.name || packageName;
    packageVersion = resolvedPackage.resolvedVersion || packageJson.version || packageVersion;
  } catch {
    throw new Error(`Failed to parse package.json from tarball`);
  }

  return {
    name: packageName,
    version: packageVersion,
    files,
  };
}

export default function DiffPackage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [package1Input, setPackage1Input] = React.useState(searchParams.get('package1') || '');
  const [package2Input, setPackage2Input] = React.useState(searchParams.get('package2') || '');

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [diffResult, setDiffResult] = React.useState<string | null>(null);
  const [resolvedPackages, setResolvedPackages] = React.useState<{
    pkg1: { name: string; version: string } | null;
    pkg2: { name: string; version: string } | null;
  }>({ pkg1: null, pkg2: null });

  const comparePackages = async () => {
    if (!package1Input.trim() || !package2Input.trim()) {
      setError('Please provide both package specifications');
      return;
    }

    const newParams = new URLSearchParams(searchParams);
    newParams.set('package1', package1Input.trim());
    newParams.set('package2', package2Input.trim());
    setSearchParams(newParams);

    setLoading(true);
    setError(null);
    setDiffResult(null);
    setResolvedPackages({ pkg1: null, pkg2: null });

    try {
      const [pkg1, pkg2] = await Promise.all([
        downloadAndExtractPackage(package1Input.trim()),
        downloadAndExtractPackage(package2Input.trim()),
      ]);

      setResolvedPackages({ pkg1, pkg2 });

      const allFiles = new Set([
        ...pkg1.files.map((f) => f.path),
        ...pkg2.files.map((f) => f.path),
      ]);

      const diffs: string[] = [];

      for (const filePath of Array.from(allFiles).sort()) {
        const file1 = pkg1.files.find((f) => f.path === filePath);
        const file2 = pkg2.files.find((f) => f.path === filePath);

        const content1 = file1?.content || '';
        const content2 = file2?.content || '';

        if (content1 !== content2) {
          const fileDiff = diff.createPatch(
            filePath,
            content1,
            content2,
            `${pkg1.name}@${pkg1.version}`,
            `${pkg2.name}@${pkg2.version}`,
          );
          diffs.push(fileDiff);
        }
      }

      setDiffResult(diffs.join('\n\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while comparing packages');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ my: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Package Diff Tool
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="From"
              size="small"
              placeholder="e.g., react@18.0.0, @mui/material@~5.0.0"
              value={package1Input}
              onChange={(event) => setPackage1Input(event.target.value)}
              sx={{ flex: 1, minWidth: '200px' }}
            />

            <ArrowForwardIcon color="action" />

            <TextField
              label="To"
              size="small"
              placeholder="e.g., react@19.0.0, @mui/material@6.x"
              value={package2Input}
              onChange={(event) => setPackage2Input(event.target.value)}
              sx={{ flex: 1, minWidth: '200px' }}
            />

            <Button
              variant="contained"
              onClick={comparePackages}
              disabled={loading || !package1Input.trim() || !package2Input.trim()}
              loading={loading}
              sx={{ minWidth: 'auto' }}
            >
              Compare
            </Button>
          </Box>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        {resolvedPackages.pkg1 && resolvedPackages.pkg2 && (
          <Box sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
            <Typography variant="h6" gutterBottom>
              Resolved Packages:
            </Typography>
            <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Box>
                <Typography variant="subtitle2" color="primary">
                  From:
                </Typography>
                <Typography variant="body2" fontFamily="monospace">
                  {resolvedPackages.pkg1.name}@{resolvedPackages.pkg1.version}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="secondary">
                  To:
                </Typography>
                <Typography variant="body2" fontFamily="monospace">
                  {resolvedPackages.pkg2.name}@{resolvedPackages.pkg2.version}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}

        {diffResult && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Diff Results:
            </Typography>
            <pre
              style={{
                background: '#1e1e1e',
                color: '#d4d4d4',
                padding: '16px',
                borderRadius: '4px',
                overflow: 'auto',
                fontSize: '12px',
                lineHeight: '1.4',
              }}
            >
              {diffResult}
            </pre>
          </Box>
        )}

        {!diffResult && !loading && !error && (
          <Alert severity="info">No differences found between the packages.</Alert>
        )}
      </Box>
    </Container>
  );
}
