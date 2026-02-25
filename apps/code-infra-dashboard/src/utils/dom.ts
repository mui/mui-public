export function escapeHtmlId(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function scrollToHash(): void {
  const { hash } = window.location;
  if (hash) {
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }
}
