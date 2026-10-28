import { afterEach } from 'vitest';
// Import from `/pure` so React Testing Library does not also auto-register its own `afterEach`
// cleanup. The root vitest config does not set `globals: true`, so we register it explicitly
// here once for every test file in the package.
// eslint-disable-next-line import/extensions
import { cleanup } from '@testing-library/react/pure.js';

// Unmount any rendered React trees after each test. Without this, a hook/component left mounted
// keeps work queued in React's scheduler; that work can flush (via `setImmediate`) after Vitest
// tears down the jsdom environment, throwing "ReferenceError: window is not defined" and failing
// an otherwise-green run. `cleanup()` is a no-op when nothing is mounted, so it is safe in the
// package's Node-only test files too.
afterEach(cleanup);
