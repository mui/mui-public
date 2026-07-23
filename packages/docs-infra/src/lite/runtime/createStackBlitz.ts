import { createSandboxFileSystem } from './createSandboxFileSystem';
import type { CreateSandboxFileSystemOptions } from './createSandboxFileSystem';

export type CreateStackBlitzOptions = CreateSandboxFileSystemOptions;

export interface StackBlitzProject {
  url: string;
  formData: Record<string, string>;
}

/** Builds a StackBlitz form payload from a sandbox file system. */
export function createStackBlitz(options: CreateStackBlitzOptions): StackBlitzProject {
  const formData: Record<string, string> = {
    'project[template]': 'node',
    'project[title]': options.title,
    ...(options.description ? { 'project[description]': options.description } : {}),
  };
  for (const [fileName, source] of Object.entries(createSandboxFileSystem(options))) {
    formData[`project[files][${fileName}]`] = source;
  }
  return {
    url: `https://stackblitz.com/run?file=src/${options.entryFileName}`,
    formData,
  };
}

/** Opens a StackBlitz project with a browser form POST. */
export function openStackBlitz({ url, formData }: StackBlitzProject): void {
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
