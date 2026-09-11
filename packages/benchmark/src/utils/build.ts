/**
 * Maps `mapper` over `items` with at most `concurrency` in flight.
 *
 * Each worker takes the next item as it frees up, so a slow item does not hold back the rest —
 * which matters when the items are `pnpm pack` invocations and each is its own node process.
 */
export async function mapConcurrently<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  if (!items.length) {
    return [];
  }
  const itemIterator = items.entries();
  const count = Math.min(concurrency, items.length);
  const results: R[] = new Array(items.length);
  const workers: Promise<void>[] = [];
  for (let index = 0; index < count; index += 1) {
    workers.push(
      Promise.resolve().then(async () => {
        for (const [itemIndex, item] of itemIterator) {
          // eslint-disable-next-line no-await-in-loop -- a worker processes its items in sequence
          results[itemIndex] = await mapper(item);
        }
      }),
    );
  }
  await Promise.all(workers);
  return results;
}
