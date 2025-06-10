import type { InfiniteDepthConfigWithExtends } from 'typescript-eslint';

type BaseConfigOptions = {
  reactCompilerEnabled?: boolean;
};

declare function createCoreConfig(options?: BaseConfigOptions): InfiniteDepthConfigWithExtends[];

export { createCoreConfig };
