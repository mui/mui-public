export function escapeHtmlId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function scrollToHash(): void {
  const { hash } = window.location;
  if (hash) {
    window.location.hash = '';
    window.location.hash = hash;
  }
}
