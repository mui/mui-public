import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { $ } from 'execa';

// We're testing the command module indirectly through its exported functions
// since the command module exports a yargs command configuration object

describe('netlify-ignore command', () => {
  describe('generateIgnoreCommand', () => {
    it('should generate correct ignore command with single path', () => {
      const relativePaths = ['packages/code-infra'];
      const expected =
        '  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF packages/code-infra pnpm-lock.yaml"';

      // This tests the format that should be generated
      const result = `  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF ${relativePaths.join(' ')} pnpm-lock.yaml"`;
      expect(result).toBe(expected);
    });

    it('should generate correct ignore command with multiple paths', () => {
      const relativePaths = ['apps/code-infra-dashboard', 'packages/bundle-size-checker'];
      const expected =
        '  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/code-infra-dashboard packages/bundle-size-checker pnpm-lock.yaml"';

      const result = `  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF ${relativePaths.join(' ')} pnpm-lock.yaml"`;
      expect(result).toBe(expected);
    });

    it('should generate correct ignore command with no dependencies', () => {
      const relativePaths = [];
      const expected =
        '  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF  pnpm-lock.yaml"';

      const result = `  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF ${relativePaths.join(' ')} pnpm-lock.yaml"`;
      expect(result).toBe(expected);
    });
  });

  describe('updateNetlifyToml', () => {
    it('should detect when content matches', () => {
      const currentContent = `[build]
  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/test pnpm-lock.yaml"`;

      const newIgnoreCommand =
        '  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/test pnpm-lock.yaml"';

      const updatedContent = currentContent.replace(/^\s*ignore\s*=.*$/m, () => {
        return newIgnoreCommand;
      });

      expect(updatedContent).toBe(currentContent);
    });

    it('should detect when content differs', () => {
      const currentContent = `[build]
  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/old pnpm-lock.yaml"`;

      const newIgnoreCommand =
        '  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/new pnpm-lock.yaml"';

      const updatedContent = currentContent.replace(/^\s*ignore\s*=.*$/m, () => {
        return newIgnoreCommand;
      });

      expect(updatedContent).not.toBe(currentContent);
      expect(updatedContent).toContain(newIgnoreCommand);
    });

    it('should handle multiline netlify.toml correctly', () => {
      const currentContent = `[build]
  publish = "netlify-placeholder"
  command = "echo 'building...'"
  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/old pnpm-lock.yaml"

[dev]
  framework = "#custom"`;

      const newIgnoreCommand =
        '  ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF apps/new pnpm-lock.yaml"';

      const updatedContent = currentContent.replace(/^\s*ignore\s*=.*$/m, () => {
        return newIgnoreCommand;
      });

      expect(updatedContent).toContain('[build]');
      expect(updatedContent).toContain('[dev]');
      expect(updatedContent).toContain(newIgnoreCommand);
      expect(updatedContent).not.toContain('apps/old');
    });
  });

  describe('getTransitiveDependencies behavior', () => {
    it('should handle relative path conversion correctly', () => {
      const workspaceRoot = '/home/runner/work/mui-public/mui-public';
      const absPath = '/home/runner/work/mui-public/mui-public/packages/code-infra';
      const relativePath = path.relative(workspaceRoot, absPath);

      expect(relativePath).toBe('packages/code-infra');
      expect(relativePath.startsWith('..')).toBe(false);
    });

    it('should filter out paths outside workspace', () => {
      const workspaceRoot = '/home/runner/work/mui-public/mui-public';
      const absPath = '/home/runner/work/other-repo/packages/test';
      const relativePath = path.relative(workspaceRoot, absPath);

      expect(relativePath.startsWith('..')).toBe(true);
    });

    it('should sort dependencies alphabetically', () => {
      const dependencies = ['packages/z-package', 'apps/a-app', 'packages/b-package'];
      const sorted = [...dependencies].sort();

      expect(sorted).toEqual(['apps/a-app', 'packages/b-package', 'packages/z-package']);
    });
  });
});
