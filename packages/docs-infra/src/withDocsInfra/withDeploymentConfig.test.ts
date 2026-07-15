import { describe, it, expect } from 'vitest';
import type { NextConfig } from 'next';
import { withDeploymentConfig } from './withDeploymentConfig';

describe('withDeploymentConfig', () => {
  it('enables webpackBuildWorker by default', () => {
    const config: NextConfig = {};
    const result = withDeploymentConfig(config);

    expect(result.experimental?.webpackBuildWorker).toBe(true);
  });

  it('lets consumers override webpackBuildWorker', () => {
    const config: NextConfig = { experimental: { webpackBuildWorker: false } };
    const result = withDeploymentConfig(config);

    expect(result.experimental?.webpackBuildWorker).toBe(false);
  });
});
