export function escapeHtmlId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getFileHashId(filePath: string): string {
  return `file-${escapeHtmlId(filePath)}`;
}
