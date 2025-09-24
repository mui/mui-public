export default {
  names: ['terminalLanguage'],
  description: 'Set the right language for terminal code.',
  tags: ['code'],
  /**
   * @param {import('./duplicate-h1.mjs').MdParams} params
   * @param {import('./duplicate-h1.mjs').OnError} onError
   */
  function: (params, onError) => {
    params.tokens.forEach((token) => {
      if (token.type === 'fence' && token.info === 'sh') {
        onError({
          lineNumber: token.lineNumber,
          detail: `Use "bash" instead of "sh".`,
        });
      }
    });
  },
};
