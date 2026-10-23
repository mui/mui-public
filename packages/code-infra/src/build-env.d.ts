export {};

// Declared the way @types/node declares `process`, so the two merge when a consumer has both.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: 'production' | undefined;
    }

    interface Process {
      env: ProcessEnv;
    }
  }

  // Only a `var` merges with the declaration in @types/node.
  // eslint-disable-next-line vars-on-top
  var process: NodeJS.Process;
}
