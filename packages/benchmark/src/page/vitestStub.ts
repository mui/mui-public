// What `vitest` resolves to in an A/B page. Benchmark files sometimes mix `benchmark()` cases with
// plain Vitest tests; outside Vitest those tests are skipped, so the file still loads and its
// `benchmark()` cases still register.

function skipped(api: string) {
  return (name?: unknown) => {
    console.warn(`${api}(${JSON.stringify(name)}) is skipped in A/B pages; only benchmark() runs.`);
  };
}

export const it = skipped('it');
export const test = skipped('test');
export const bench = skipped('bench');
export const beforeAll = skipped('beforeAll');
export const afterAll = skipped('afterAll');
export const beforeEach = skipped('beforeEach');
export const afterEach = skipped('afterEach');
export const onTestFinished = skipped('onTestFinished');

export function describe(_name: string, factory?: () => void): void {
  factory?.();
}

export function expect(): never {
  throw new Error('expect() is not available in A/B pages.');
}
