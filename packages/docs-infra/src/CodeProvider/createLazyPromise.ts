/** Creates a Promise-compatible thenable whose factory starts on first consumption. */
export function createLazyPromise<T>(factory: () => Promise<T>): Promise<T> {
  let promise: Promise<T> | undefined;
  const getPromise = () => {
    promise ??= factory();
    return promise;
  };

  return {
    then: (onfulfilled, onrejected) => getPromise().then(onfulfilled, onrejected),
    catch: (onrejected) => getPromise().catch(onrejected),
    finally: (onfinally) => getPromise().finally(onfinally),
    [Symbol.toStringTag]: 'Promise',
  };
}
