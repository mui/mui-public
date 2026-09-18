// Version comparison for Renovate targets, without pulling in semver.

/** Compare two version strings, tolerating range prefixes and prereleases. */
export function compareVersions(left, right) {
  const parse = (version) => {
    const [main, prerelease] = version.replace(/^[\^~>=<v\s]+/, '').split('-');
    return {
      main: main.split('.').map((segment) => Number.parseInt(segment, 10) || 0),
      prerelease: prerelease ? prerelease.split('.') : null,
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.main.length, b.main.length); index += 1) {
    const diff = (a.main[index] ?? 0) - (b.main[index] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  // A prerelease sorts before the matching release: 5.0.0-canary.1 < 5.0.0.
  if (a.prerelease === null || b.prerelease === null) {
    return (a.prerelease === null ? 1 : 0) - (b.prerelease === null ? 1 : 0);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const [x, y] = [a.prerelease[index], b.prerelease[index]];
    if (x === y) {
      continue;
    }
    if (x === undefined || y === undefined) {
      return x === undefined ? -1 : 1;
    }
    const [nx, ny] = [Number(x), Number(y)];
    const diff = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    return Math.sign(diff);
  }
  return 0;
}
