/**
 * @param {string} pkgVersion
 * @returns {Record<string, string>}
 */
export function getVersionEnvVariables(pkgVersion) {
  if (!pkgVersion) {
    throw new Error('No version found in package.json');
  }

  const [versionNumber, prerelease] = pkgVersion.split('-');
  const [major, minor, patch] = versionNumber.split('.');

  if (!major || !minor || !patch) {
    throw new Error(`Couldn't parse version from package.json`);
  }

  const env = {
    MUI_VERSION: pkgVersion,
    MUI_MAJOR_VERSION: major,
    MUI_MINOR_VERSION: minor,
    MUI_PATCH_VERSION: patch,
    MUI_PRERELEASE: prerelease,
  };
  return Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => [
      [`import.meta.env.${key}`, JSON.stringify(value)],
      [`process.env.${key}`, JSON.stringify(value)],
    ]),
  );
}
