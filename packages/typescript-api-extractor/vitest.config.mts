import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every case builds a real TypeScript program and walks the checker's type
    // graph. A case finishes well inside a second on an idle machine, but the
    // suite runs its files in parallel and the resulting CPU contention pushes
    // individual cases past Vitest's 5s default often enough to fail runs that
    // have nothing wrong with them. The limit is here to catch a genuine hang,
    // so it is set well clear of that noise rather than close to it.
    testTimeout: 30_000,
  },
});
