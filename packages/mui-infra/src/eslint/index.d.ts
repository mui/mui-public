import type { ConfigArray } from 'typescript-eslint';

type BaseConfigOptions = {
  enableReactCompiler?: boolean;
};

declare function createBaseConfig(options?: BaseConfigOptions): ConfigArray;
declare function createTestConfig(): ConfigArray;

export { createBaseConfig, createTestConfig };
