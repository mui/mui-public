/**
 * Computes a short, deterministic base36 hash of a string.
 *
 * Deterministic and dependency-free: the same input always yields the same
 * output, which matters when the result must agree across server render and
 * client hydration. Uses a polynomial rolling hash modulo a Mersenne prime
 * (2^31 - 1) — only arithmetic (no bitwise ops), staying within `Number`'s
 * exact-integer range. Not cryptographic; meant for cheap, stable identifiers
 * such as scoped CSS class suffixes.
 */
export function hashString(input: string): string {
  const MODULUS = 2147483647; // 2^31 - 1
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    // `hash < MODULUS` and the multiplier keep the product well under 2^53, so
    // every step is exact.
    hash = (hash * 131 + input.charCodeAt(index)) % MODULUS;
  }
  return hash.toString(36);
}
