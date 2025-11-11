export function createSitemap(
  sourceUrl: string,
  pages: Record<string, React.ComponentType<any>>,
  options?: { precompute: { schema: {}; data: {} } },
) {
  return options?.precompute;
}
