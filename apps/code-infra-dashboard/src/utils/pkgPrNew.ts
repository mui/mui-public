export function getPkgPrNewUrl(
  owner: string,
  repo: string,
  packageName: string,
  sha: string,
): string {
  return `https://pkg.pr.new/${owner}/${repo}/${packageName}@${sha.slice(0, 7)}`;
}
