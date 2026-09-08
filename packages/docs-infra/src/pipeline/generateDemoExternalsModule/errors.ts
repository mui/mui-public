export class ServerOnlyDemoExternalError extends Error {
  constructor(
    /** Server-only modules found in the source graph. */
    readonly modules: string[],
    /** Source URLs discovered before validation failed. */
    readonly dependencies: string[],
  ) {
    super(`Cannot generate client externals for server-only modules: ${modules.join(', ')}`);
    this.name = 'ServerOnlyDemoExternalError';
  }
}
