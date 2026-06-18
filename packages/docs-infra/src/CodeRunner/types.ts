/**
 * The set of identifiers exposed to evaluated source as local variables.
 *
 * Every own-enumerable key becomes a binding in the generated function, with two
 * reserved keys handled specially: `import` is the registry consulted by
 * (transpiled) `import` statements, and `default` is never bound because it is a
 * reserved word and cannot name a function parameter.
 *
 * A cleanroom reimplementation of the `react-runner` runtime (MIT, © 2019 Neo);
 * the public surface (`useRunner`, `importCode`, `Runner`, …) mirrors that
 * library so it can be vendored as a drop-in replacement.
 */
export type Scope = Record<string, unknown> & {
  /** Registry consulted by transpiled `import` statements, keyed by specifier. */
  import?: Record<string, unknown>;
};

/** Inputs shared by every entry point that transpiles and evaluates a source string. */
export interface RunnerOptions {
  /** The TypeScript/JSX source to transpile and evaluate. */
  code: string;
  /** Identifiers (and an `import` registry) exposed to the evaluated source. */
  scope?: Scope;
}
