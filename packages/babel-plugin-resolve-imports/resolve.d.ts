declare module 'resolve/sync.js' {
  import type { Opts } from 'resolve';

  function resolve(id: string, options?: Opts): string;
  export = resolve;
}
