import * as React from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Container,
  Typography,
  Alert,
  Box,
  TextField,
  Button,
  useEventCallback,
  Checkbox,
  FormControlLabel,
  Skeleton,
  Paper,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
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
}

function isUrl(str: string): boolean {
  try {
    return !!new URL(str);
  } catch {
    return false;
  }
}

async function resolvePackageDownloadUrl(packageSpec: string): Promise<ResolvedPackage> {
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

// Component for displaying individual package info
interface PackageInfoProps {
  label: string;
  color: 'primary' | 'secondary';
  resolvedSpec: string | null;
  error: Error | null;
}

function PackageInfo({ label, color, resolvedSpec, error }: PackageInfoProps) {
  return (
    <Box>
      <Typography variant="subtitle2" color={color}>
        {label}:
      </Typography>
      <Typography variant="body2" color={error ? 'error' : undefined} fontFamily="monospace">
        {error
          ? `Error: ${error.message}`
          : resolvedSpec || <Skeleton variant="text" width={300} />}
      </Typography>
    </Box>
  );
}

// Component for displaying individual file diff
interface FileDiffProps {
  old: string;
  new: string;
  filePath: string;
  oldHeader: string;
  newHeader: string;
  ignoreWhitespace: boolean;
}

function FileDiff({
  old,
  new: newContent,
  filePath,
  oldHeader,
  newHeader,
  ignoreWhitespace,
}: FileDiffProps) {
  const fileDiff = React.useMemo(() => {
    return diff.createPatch(filePath, old, newContent, oldHeader, newHeader, { ignoreWhitespace });
  }, [old, newContent, filePath, oldHeader, newHeader, ignoreWhitespace]);

  return (
    <Paper>
      <pre
        style={{
          padding: '16px',
          margin: 0,
          overflow: 'auto',
          fontSize: '12px',
          lineHeight: '1.4',
        }}
      >
        {fileDiff}
      </pre>
    </Paper>
  );
}

// Custom hook for downloading a package using React Query
function usePackageDownload(packageSpec: string | null) {
  return useQuery({
    queryKey: ['package-download', packageSpec],
    queryFn: () => downloadAndExtractPackage(packageSpec!),
    enabled: Boolean(packageSpec?.trim()),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export default function DiffPackage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [package1Input, setPackage1Input] = React.useState(searchParams.get('package1') || '');
  const [package2Input, setPackage2Input] = React.useState(searchParams.get('package2') || '');
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(true);

  const package1Spec = searchParams.get('package1');
  const package2Spec = searchParams.get('package2');

  const pkg1Query = usePackageDownload(package1Spec);
  const pkg2Query = usePackageDownload(package2Spec);

  const pkg1 = pkg1Query.data;
  const pkg2 = pkg2Query.data;

  const filesToDiff = React.useMemo(() => {
    if (!pkg1 || !pkg2) {
      return [];
    }

    const pkg1FileMap = new Map(pkg1.files.map((file) => [file.path, file]));
    const pkg2FileMap = new Map(pkg2.files.map((file) => [file.path, file]));

    const allFiles = new Set([...pkg1FileMap.keys(), ...pkg2FileMap.keys()]);

    const files: {
      filePath: string;
      old: string;
      new: string;
      oldHeader: string;
      newHeader: string;
    }[] = [];

    for (const filePath of Array.from(allFiles).sort()) {
      const file1 = pkg1FileMap.get(filePath);
      const file2 = pkg2FileMap.get(filePath);

      const content1 = file1?.content || '';
      const content2 = file2?.content || '';

      if (content1 !== content2) {
        files.push({
          filePath,
          old: content1,
          new: content2,
          oldHeader: `${pkg1.name}@${pkg1.version}`,
          newHeader: `${pkg2.name}@${pkg2.version}`,
        });
      }
    }

    return files;
  }, [pkg1, pkg2]);

  const loading = pkg1Query.isLoading || pkg2Query.isLoading;
  const error = pkg1Query.error || pkg2Query.error;

  const onCompareClick = useEventCallback(() => {
    const pkg1Spec = package1Input.trim();
    const pkg2Spec = package2Input.trim();

    if (!pkg1Spec || !pkg2Spec) {
      return;
    }

    setSearchParams((params) => {
      params.set('package1', pkg1Spec);
      params.set('package2', pkg2Spec);
      return params;
    });
  });

  // Sync input fields with URL parameters when they change
  React.useEffect(() => {
    setPackage1Input(searchParams.get('package1') || '');
    setPackage2Input(searchParams.get('package2') || '');
  }, [searchParams]);

  return (
    <Container maxWidth="xl">
      <Box sx={{ my: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Package Diff Tool
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexDirection: { xs: 'column', sm: 'row' },
              width: '100%',
            }}
          >
            <TextField
              label="From"
              size="small"
              placeholder="e.g., react@18.0.0, @mui/material@~5.0.0"
              value={package1Input}
              onChange={(event) => setPackage1Input(event.target.value)}
              sx={{
                flex: { sm: 1 },
                width: { xs: '100%', sm: 'auto' },
                minWidth: '200px',
              }}
            />

            <Box
              sx={{
                display: { xs: 'block', sm: 'block' },
                alignSelf: 'center',
              }}
            >
              <ArrowForwardIcon color="action" sx={{ display: { xs: 'none', sm: 'block' } }} />
              <ArrowDownwardIcon color="action" sx={{ display: { xs: 'block', sm: 'none' } }} />
            </Box>

            <TextField
              label="To"
              size="small"
              placeholder="e.g., react@19.0.0, @mui/material@6.x"
              value={package2Input}
              onChange={(event) => setPackage2Input(event.target.value)}
              sx={{
                flex: { sm: 1 },
                width: { xs: '100%', sm: 'auto' },
                minWidth: '200px',
              }}
            />

            <Button
              variant="contained"
              onClick={onCompareClick}
              disabled={loading || !package1Input.trim() || !package2Input.trim()}
              loading={loading}
              sx={{
                minWidth: 'auto',
                width: { xs: '100%', sm: 'auto' },
                mt: { xs: 1, sm: 0 },
              }}
            >
              Compare
            </Button>
          </Box>
        </Box>

        {(package1Spec || package2Spec) && (
          <Box sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
            <Typography variant="h6" gutterBottom>
              Resolved Packages:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, flexWrap: 'wrap' }}>
              <PackageInfo
                label="From"
                color="primary"
                resolvedSpec={pkg1 ? `${pkg1.name}@${pkg1.version}` : null}
                error={pkg1Query.error}
              />
              <PackageInfo
                label="To"
                color="secondary"
                resolvedSpec={pkg2 ? `${pkg2.name}@${pkg2.version}` : null}
                error={pkg2Query.error}
              />
            </Box>
          </Box>
        )}

        {!error && (
          <Box>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2,
              }}
            >
              <Typography variant="h6">
                Diff Results {loading ? '' : `(${filesToDiff.length} files changed):`}
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={ignoreWhitespace}
                    onChange={(event) => setIgnoreWhitespace(event.target.checked)}
                    size="small"
                  />
                }
                label="Ignore whitespace"
              />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {loading ? (
                <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
              ) : (
                <React.Fragment>
                  {filesToDiff.length > 0 ? (
                    filesToDiff.map(({ filePath, old, new: newContent, oldHeader, newHeader }) => (
                      <FileDiff
                        key={filePath}
                        filePath={filePath}
                        old={old}
                        new={newContent}
                        oldHeader={oldHeader}
                        newHeader={newHeader}
                        ignoreWhitespace={ignoreWhitespace}
                      />
                    ))
                  ) : (
                    <Alert severity="info">No differences found between the packages.</Alert>
                  )}
                </React.Fragment>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </Container>
  );
}
