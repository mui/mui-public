/**
 * Lints the output directory with publint. Errors fail the build, warnings are only reported.
 * @param {string} buildDir - The build directory to validate.
 * @returns {Promise<void>}
 */
export async function validateWithPublint(buildDir) {
  const [{ publint }, { formatMessage }] = await Promise.all([
    import('publint'),
    import('publint/utils'),
  ]);
  // Everything in the output directory is published, so there is nothing to pack.
  const result = await publint({ pkgDir: buildDir, pack: false, level: 'warning' });
  const { pkg } = result;
  // TODO: remove this filter and bump publint to >=0.3.25, which ships the fix from
  // https://github.com/publint/publint/pull/265 (publint checks `browser` values
  // that point at another package as local files).
  const messages = result.messages.filter((message) => {
    if (message.code !== 'FILE_DOES_NOT_EXIST' || message.path[0] !== 'browser') {
      return true;
    }
    const value = message.path.length === 2 ? pkg.browser?.[message.path[1]] : undefined;
    return typeof value !== 'string' || value.startsWith('.');
  });

  for (const message of messages) {
    const log = message.type === 'error' ? console.error : console.warn;
    log(`publint ${message.type}: ${formatMessage(message, pkg)}`);
  }

  const errorCount = messages.filter((message) => message.type === 'error').length;
  if (errorCount > 0) {
    throw new Error(`publint found ${errorCount} error(s) in "${buildDir}".`);
  }
}
