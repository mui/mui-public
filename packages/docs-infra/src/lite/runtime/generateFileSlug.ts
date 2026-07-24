export function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Generates a stable variant/file anchor slug. */
export function generateFileSlug(mainSlug: string, fileName: string, variantName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  const baseName = lastDotIndex !== -1 ? fileName.slice(0, lastDotIndex) : fileName;
  const extension = lastDotIndex !== -1 ? fileName.slice(lastDotIndex) : '';
  const kebabFileName = `${toKebabCase(baseName)}${extension}`;
  if (!mainSlug) {
    return kebabFileName;
  }
  if (variantName === 'Default') {
    return `${mainSlug}:${kebabFileName}`;
  }
  return `${mainSlug}:${toKebabCase(variantName)}:${kebabFileName}`;
}
