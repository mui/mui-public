import { BundlerConfig, BundlerType } from '../types';
import { BinField, ExportsField } from '../utils/resolve-entrypoints';
import { generateBanner } from '../utils/config-finder';

export interface BundlerOutput {
  exports: ExportsField;
  bin: BinField;
}

export interface BundlerAdapter {
  /** The name of the bundler */
  name: BundlerType;

  /** Build the bundle and return the generated exports field */
  build(config: BundlerConfig): Promise<BundlerOutput>;
}

export abstract class BaseBundlerAdapter implements BundlerAdapter {
  abstract name: BundlerType;

  abstract build(config: BundlerConfig): Promise<BundlerOutput>;

  protected getExternalDependencies(config: BundlerConfig): string[] {
    const deps = new Set<string>(
      Array.from([
        ...Object.keys(config.packageInfo.peerDependencies ?? {}),
        ...Object.keys(config.packageInfo.dependencies ?? {}),
      ]),
    );
    return Array.from(deps);
  }

  protected getBanner(config: BundlerConfig): string {
    return generateBanner(config.packageInfo);
  }
}
