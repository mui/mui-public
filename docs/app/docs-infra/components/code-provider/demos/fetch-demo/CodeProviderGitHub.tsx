import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import type {
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
} from '@mui/internal-docs-infra/CodeHighlighter/types';

const loadCodeMeta: LoadCodeMeta = async (url) => {
  // Extract the part after 'app/' from the URL
  const urlParts = url.split('app/');
  if (urlParts.length < 2) {
    throw new Error('Invalid URL format: expected path containing "app/"');
  }
  const pathAfterApp = urlParts[1];

  const response = await fetch(
    `https://api.github.com/repos/mui/mui-public/contents/packages/docs-infra/docs/app/${pathAfterApp}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load code meta: ${response.statusText}`);
  }
  const data = await response.json();

  const code: Record<string, string> = {};

  // Handle both single file and directory responses
  const files = Array.isArray(data) ? data : [data];

  files.forEach(({ type, name }: { type: string; name: string }) => {
    if (type === 'dir') {
      code[name] = name;
    }
  });

  return code;
};

const loadVariantMeta: LoadVariantMeta = async (variantName: string, url: string) => {
  // Extract the part after 'app/' from the URL
  const urlParts = url.split('app/');
  if (urlParts.length < 2) {
    throw new Error('Invalid URL format: expected path containing "app/"');
  }
  const pathAfterApp = urlParts[1];

  const response = await fetch(
    `https://api.github.com/repos/mui/mui-public/contents/packages/docs-infra/docs/app/${pathAfterApp}/${variantName}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load variant meta: ${response.statusText}`);
  }
  const data = await response.json();

  const extraFiles: Record<string, string> = {};

  // Handle both single file and directory responses
  const files = Array.isArray(data) ? data : [data];

  files.forEach(({ type, name }: { type: string; name: string }) => {
    if (type === 'file') {
      extraFiles[name] = name;
    }
  });

  return {
    fileName: files.find(({ type }: { type: string }) => type === 'file')?.name || 'index.tsx',
    extraFiles,
  };
};

const loadSource: LoadSource = async (url: string) => {
  // Extract the part after 'app/' from the URL
  const urlParts = url.split('app/');
  if (urlParts.length < 2) {
    throw new Error('Invalid URL format: expected path containing "app/"');
  }
  const pathAfterApp = urlParts[1];

  const response = await fetch(
    `https://raw.githubusercontent.com/mui/mui-public/master/packages/docs-infra/docs/app/${pathAfterApp}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load source code: ${response.statusText}`);
  }
  return {
    source: await response.text(),
  };
};

export function CodeProviderGitHub({ children }: { children: React.ReactNode }) {
  return (
    <CodeProvider
      loadCodeMeta={loadCodeMeta}
      loadVariantMeta={loadVariantMeta}
      loadSource={loadSource}
    >
      {children}
    </CodeProvider>
  );
}
