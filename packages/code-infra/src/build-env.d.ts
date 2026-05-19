export {};

declare global {
  interface Env {
    NODE_ENV?: 'production' | undefined;
    MUI_VERSION?: string;
  }

  interface Process {
    env: Env;
  }

  const process: Process;
}
