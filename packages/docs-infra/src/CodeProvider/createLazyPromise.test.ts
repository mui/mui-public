import { describe, expect, it, vi } from 'vitest';
import { createLazyPromise } from './createLazyPromise';

describe('createLazyPromise', () => {
  it('does not run the factory until the promise is consumed', async () => {
    const factory = vi.fn(async () => 'value');
    const promise = createLazyPromise(factory);

    expect(factory).not.toHaveBeenCalled();
    await expect(promise).resolves.toBe('value');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('shares one factory call between consumers', async () => {
    const factory = vi.fn(async () => 'value');
    const promise = createLazyPromise(factory);

    await expect(Promise.all([promise, promise])).resolves.toEqual(['value', 'value']);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
