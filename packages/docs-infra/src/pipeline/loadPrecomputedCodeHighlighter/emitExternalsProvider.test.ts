import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import {
  emitExternalsProvider,
  testHelpers,
  type LoaderContext,
  type ExternalsProviderInfo,
} from './emitExternalsProvider';

// Mock fs/promises module
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
  constants: { F_OK: 0 },
}));

// Get the mocked functions
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);

// Mock console.warn
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('emitExternalsProvider', () => {
  let mockLoaderContext: LoaderContext;
  let externalsProviderInfo: ExternalsProviderInfo;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLoaderContext = {
      resourcePath: '/project/app/components/demo.tsx',
      addDependency: vi.fn(),
      emitFile: undefined, // Will be set per test
    };

    externalsProviderInfo = {
      fileName: '/project/app/components/demo.externals.tsx',
      content: "'use client';\n\nexport function CodeExternalsProvider() {}",
      relativePath: './demo.externals.tsx',
    };

    // Mock access to find package.json
    mockAccess.mockImplementation(async (path: any) => {
      const pathStr = path.toString();
      // App project - has app directory at /app-project/app
      if (pathStr === '/app-project/app') {
        return; // Success, directory exists
      }
      // Standard project - has package.json at /project/package.json
      if (pathStr === '/project/package.json') {
        return; // Success, file exists
      }
      // Fail for all other paths
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';
      throw error;
    });
  });

  describe('with emitFile available (webpack)', () => {
    it('should use emitFile when available', async () => {
      const emitFileMock = vi.fn();
      mockLoaderContext.emitFile = emitFileMock;

      const result = await emitExternalsProvider(mockLoaderContext, externalsProviderInfo);

      expect(emitFileMock).toHaveBeenCalledWith(
        'demo.externals.tsx',
        "'use client';\n\nexport function CodeExternalsProvider() {}",
      );
      expect(result).toBe('./demo.externals.tsx');
      expect(mockLoaderContext.addDependency).not.toHaveBeenCalled();
    });
  });

  describe('without emitFile (turbopack/other bundlers)', () => {
    it('should write to structured generated directory when emitFile not available', async () => {
      const result = await emitExternalsProvider(mockLoaderContext, externalsProviderInfo);

      // Should have called writeFile with structured path
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/project/generated/demo-externals/app/components/demo.tsx',
        "'use client';\n\nexport function CodeExternalsProvider() {}",
      );

      // Should have added dependency
      expect(mockLoaderContext.addDependency).toHaveBeenCalledWith(
        '/project/generated/demo-externals/app/components/demo.tsx',
      );

      // Should have created directory
      expect(mockMkdir).toHaveBeenCalledWith('/project/generated/demo-externals/app/components', {
        recursive: true,
      });

      // Should return relative path
      expect(result).toBe('../../generated/demo-externals/app/components/demo.tsx');
    });
  });
});

describe('testHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRelativePath', () => {
    it('should create relative path between files', () => {
      const result = testHelpers.createRelativePath(
        '/project/src/demo.tsx',
        '/project/src/demo.externals.tsx',
      );
      expect(result).toBe('./demo.externals.tsx');
    });

    it('should create relative path across directories', () => {
      const result = testHelpers.createRelativePath(
        '/project/src/demo.tsx',
        '/project/.next/cache/externals/demo.externals.tsx',
      );
      expect(result).toBe('../.next/cache/externals/demo.externals.tsx');
    });
  });

  describe('createGeneratedFilePath', () => {
    it('should create structured path for app directory files', async () => {
      const result = await testHelpers.createGeneratedFilePath(
        '/project/app/components/checkbox/demos/basic/index.ts',
        '/project',
      );

      expect(result.filePath).toBe(
        '/project/generated/demo-externals/app/components/checkbox/demos/basic.tsx',
      );
      expect(result.relativePath).toBe(
        '../../../../../generated/demo-externals/app/components/checkbox/demos/basic.tsx',
      );
    });

    it('should handle files without extensions', async () => {
      const result = await testHelpers.createGeneratedFilePath('/project/app/demo', '/project');

      expect(result.filePath).toBe('/project/generated/demo-externals/app/demo.tsx');
      expect(result.relativePath).toBe('../generated/demo-externals/app/demo.tsx');
    });
  });

  describe('findProjectRoot', () => {
    it('should find project root by app directory first', async () => {
      // Mock to find app directory at /app-project/app
      mockAccess.mockImplementation(async (path: any) => {
        const pathStr = path.toString();
        if (pathStr === '/app-project/app') {
          return; // Success, directory exists
        }
        // Fail for all other paths
        const error = new Error('ENOENT: no such file or directory');
        (error as any).code = 'ENOENT';
        throw error;
      });

      const result = await testHelpers.findProjectRoot('/app-project/app/components/demo.tsx');
      expect(result).toBe('/app-project');
    });

    it('should find project root by package.json when app not found', async () => {
      // Mock to only find package.json, not app
      mockAccess.mockImplementation(async (path: any) => {
        const pathStr = path.toString();
        if (pathStr === '/project/package.json') {
          return; // Success
        }
        const error = new Error('ENOENT: no such file or directory');
        (error as any).code = 'ENOENT';
        throw error;
      });

      const result = await testHelpers.findProjectRoot('/project/src/deep/nested/demo.tsx');
      expect(result).toBe('/project');
    });
  });

  describe('ensureGitignoreEntry', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should create .gitignore with entry when file does not exist', async () => {
      // Mock access to throw (file doesn't exist)
      mockAccess.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/project/.gitignore',
        '/generated/demo-externals\n',
      );
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "[mui-docs-infra] Added '/generated/demo-externals' to .gitignore to prevent committing generated externals files. " +
          "If you want to commit these files, add '!/generated/demo-externals' or '# mui-docs-infra: allow generated demo externals' to your .gitignore.",
      );
    });

    it('should add entry to existing .gitignore when entry does not exist', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/project/.gitignore',
        'node_modules/\n*.log\n/generated/demo-externals\n',
      );
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "[mui-docs-infra] Added '/generated/demo-externals' to .gitignore to prevent committing generated externals files. " +
          "If you want to commit these files, add '!/generated/demo-externals' or '# mui-docs-infra: allow generated demo externals' to your .gitignore.",
      );
    });

    it('should not modify .gitignore when entry already exists', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\n/generated/demo-externals\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should recognize /generated/demo-externals format', async () => {
      vi.clearAllMocks();
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\n/generated/demo-externals\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should recognize generated/demo-externals format', async () => {
      vi.clearAllMocks();
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\ngenerated/demo-externals\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should recognize /generated/demo-externals/ format', async () => {
      vi.clearAllMocks();
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\n/generated/demo-externals/\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should recognize generated/demo-externals/ format', async () => {
      vi.clearAllMocks();
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\ngenerated/demo-externals/\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should handle .gitignore without trailing newline', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/project/.gitignore',
        'node_modules/\n/generated/demo-externals\n',
      );
    });

    it('should not add entry when explicitly whitelisted with negation pattern', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\n!/generated/demo-externals\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should not add entry when explicitly whitelisted with comment', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(
        'node_modules/\n# mui-docs-infra: allow generated demo externals\n*.log\n',
      );

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should not add entry when custom whitelist comment is present', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(
        'node_modules/\n# Custom comment: mui-docs-infra: allow generated demo externals for this project\n*.log\n',
      );

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockConsoleWarn).not.toHaveBeenCalled();
    });

    it('should add entry even when ignore pattern exists but no whitelist', async () => {
      // Mock access to succeed (file exists)
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue('node_modules/\n*.log\n');

      await testHelpers.ensureGitignoreEntry('/project');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/project/.gitignore',
        'node_modules/\n*.log\n/generated/demo-externals\n',
      );
      expect(mockConsoleWarn).toHaveBeenCalled();
    });
  });
});
