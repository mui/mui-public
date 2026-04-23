const nonStraightQuotes = /[‘’“”]/;

export default {
  names: ['straightQuotes'],
  description: 'Only allow straight quotes.',
  tags: ['spelling'],
  /**
   * @param {import('./duplicate-h1.mjs').MdParams} params
   * @param {import('./duplicate-h1.mjs').OnError} onError
   */
  function: (params, onError) => {
    params.lines.forEach((line, lineNumber) => {
      // It will match
      // opening single quote: \xE2\x80\x98
      // closing single quote: \xE2\x80\x99
      // opening double quote: \xE2\x80\x9C
      // closing double quote: \xE2\x80\x9D
      if (nonStraightQuotes.test(line)) {
        onError({
          lineNumber: lineNumber + 1,
          detail: `For line: ${line}`,
        });
      }
    });
  },
};
