import * as React from 'react';
import { benchmark } from '@mui/internal-benchmark';

function Counter() {
  const [count, setCount] = React.useState(0);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      Count: {count}
    </button>
  );
}

benchmark('Counter mount', <Counter />, undefined, { runs: 10, warmupRuns: 5 });
