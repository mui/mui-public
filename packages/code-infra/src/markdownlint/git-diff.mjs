export default {
  names: ['gitDiff'],
  description: 'Respect the format output of git diff.',
  tags: ['spaces'],
  /**
   * @param {import('./duplicate-h1.mjs').MdParams} params
   * @param {import('./duplicate-h1.mjs').OnError} onError
   */
  function: (params, onError) => {
    params.tokens.forEach((token) => {
      if (token.type === 'fence' && token.info === 'diff') {
        token.content.split('\n').forEach((line, index) => {
          if (
            line[0] !== ' ' &&
            line[0] !== '-' &&
            line[0] !== '+' &&
            line !== '' &&
            line.indexOf('@@ ') !== 0 &&
            line.indexOf('diff --git ') !== 0 &&
            line.indexOf('index ') !== 0
          ) {
            onError({
              lineNumber: token.lineNumber + index + 1,
              detail: `The line start with "+" or "-" or " ": ${line}`,
            });
          }
        });
      }
    });
  },
};
