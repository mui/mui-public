import LZString from 'lz-string';
import { createSandboxFileSystem } from './createSandboxFileSystem';
import type { CreateSandboxFileSystemOptions } from './createSandboxFileSystem';

export type CreateCodeSandboxOptions = CreateSandboxFileSystemOptions;

export interface CodeSandboxProject {
  url: string;
  formData: Record<string, string>;
}

function compress(value: object): string {
  return LZString.compressToBase64(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** Builds a CodeSandbox Define API payload for a demo. */
export function createCodeSandbox(options: CreateCodeSandboxOptions): CodeSandboxProject {
  const files = Object.fromEntries(
    Object.entries(createSandboxFileSystem(options)).map(([fileName, content]) => [
      fileName,
      { content },
    ]),
  );
  return {
    url: 'https://codesandbox.io/api/v1/sandboxes/define',
    formData: {
      parameters: compress({ files }),
      query: `file=src/${options.entryFileName}`,
    },
  };
}

/** Opens a CodeSandbox project with a browser form POST. */
export function openCodeSandbox({ url, formData }: CodeSandboxProject): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.target = '_blank';
  form.action = url;
  for (const [name, value] of Object.entries(formData)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
