const ENV_VALUES: Record<string, boolean> = { true: true, '1': true, false: false, '0': false };

/**
 * A boolean setting of the harness: the option when given, then the environment variable `name`,
 * then `fallback`. Any other value of the variable throws, saying what running with it would do
 * (`consequence`), rather than falling back silently.
 */
export function resolveBooleanSetting(
  name: string,
  option: boolean | undefined,
  fallback: boolean,
  consequence: string,
): boolean {
  if (option !== undefined) {
    return option;
  }
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  // Own keys only: `in` would accept inherited names such as `constructor`.
  if (!Object.hasOwn(ENV_VALUES, value)) {
    throw new Error(
      `Unknown ${name} value "${value}". ${consequence} Set it to one of: true, false, 1, 0.`,
    );
  }
  return ENV_VALUES[value];
}
