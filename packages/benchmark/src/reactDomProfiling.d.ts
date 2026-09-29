// `@types/react-dom` types `react-dom/client` but not the profiling build, which has the same API.
declare module 'react-dom/profiling' {
  export * from 'react-dom/client';
}
