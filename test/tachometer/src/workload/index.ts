import { reactMajor } from '@mui/internal-test-utils/env';
import { measureMount, numberParam } from '../_shared/measure';

/**
 * A deterministic CPU workload, sized by `?size=`.
 *
 * The point of this page is not the number it produces — this repository ships build tooling, not a
 * browser library, so there is nothing here whose render time is worth tracking. It exists to give
 * `code-infra tacho run` something real to drive end to end.
 *
 * It does import a workspace package (`@mui/internal-test-utils`) and put its value on screen. That
 * is the part that matters: the working tree resolves it through the workspace link to the
 * package's build output, while every other ref resolves it from a packed tarball in an isolated
 * install. If either path breaks, this page fails to build rather than silently measuring nothing.
 */

/** A small linear congruential generator, so every sample does identical work. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

measureMount(() => {
  const size = numberParam('size', 50_000);
  const random = createRandom(42);

  const values = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    values[index] = random();
  }
  values.sort();

  let checksum = 0;
  for (let index = 0; index < size; index += 1) {
    checksum += values[index] * index;
  }

  return `size=${size} checksum=${checksum.toFixed(3)} react=${reactMajor}`;
});
