import type { ConfigArray, ConfigWithExtends } from 'typescript-eslint';

type BaseConfigOptions = {
  enableReactCompiler?: boolean;
};

declare const baseSpecRules: ConfigWithExtends;

declare function createBaseConfig(options?: BaseConfigOptions): ConfigArray;
declare function createTestConfig(): ConfigArray;

export { baseSpecRules, createBaseConfig, createTestConfig };
