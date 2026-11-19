import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Octokit } from '@octokit/rest';
import { execa } from 'execa';

interface RecordedPackage {
  path: string;
  name: string | null;
  version: string | null;
  private: boolean;
}

interface RecordedWorkspace {
  globs: string[];
  root: Omit<RecordedPackage, 'path'>;
  packages: RecordedPackage[];
}

/** GitHub responses for one release range, recorded by `record.mjs`, plus both workspace states. */
export interface Recording {
  repo: string;
  lastRelease: string;
  release: string;
  version: string;
  date: string;
  workspace: { release: RecordedWorkspace; lastRelease: RecordedWorkspace };
  componentDirs?: Record<string, string[]>;
  responses: Record<string, { status: number; headers: Record<string, string>; body: unknown }>;
}

export const RECORDINGS = new URL('./recordings/', import.meta.url);

export async function listRecordings(repo: string) {
  const files = await fs.readdir(new URL(`${repo}/`, RECORDINGS));

  return files.filter((file) => file.endsWith('.json.gz')).map((file) => `${repo}/${file}`);
}

export async function readRecording(file: string): Promise<Recording> {
  return JSON.parse(gunzipSync(await fs.readFile(new URL(file, RECORDINGS))).toString('utf8'));
}

/** A real Octokit whose HTTP layer serves the recording and fails on anything else. */
export function replay(recording: Recording): Octokit {
  return new Octokit({
    request: {
      fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const key = `${request.method} ${url.pathname}${url.search}`;
        const entry = recording.responses[key];

        if (!entry) {
          throw new Error(`Unrecorded request: ${key}`);
        }

        const response = new Response(entry.status === 204 ? null : JSON.stringify(entry.body), {
          status: entry.status,
          headers: entry.headers,
        });

        return Object.defineProperty(response, 'url', { value: request.url });
      },
    },
  });
}

const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

async function writeWorkspace(cwd: string, workspace: RecordedWorkspace) {
  await fs.writeFile(
    path.join(cwd, 'pnpm-workspace.yaml'),
    `packages:\n${workspace.globs.map((glob) => `  - '${glob}'`).join('\n')}\n`,
  );
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify(workspace.root));
  await Promise.all(
    workspace.packages.map(async ({ path: directory, ...manifest }) => {
      await fs.mkdir(path.join(cwd, directory), { recursive: true });
      await fs.writeFile(path.join(cwd, directory, 'package.json'), JSON.stringify(manifest));
    }),
  );
}

/**
 * A git repository holding the recorded manifests: `lastRelease` and `release` tag the two states.
 * The caller removes it.
 */
export async function materialize(recording: Recording) {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-recording-')));
  const git = (...args: string[]) => execa('git', args, { cwd, env: GIT_ENV });

  const commit = async (ref: string) => {
    await git('add', '-A');
    await git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      ref,
    );
    await git('tag', ref);
  };

  await git('init', '-q');
  await writeWorkspace(cwd, recording.workspace.lastRelease);
  await commit(recording.lastRelease);

  const entries = await fs.readdir(cwd);
  await Promise.all(
    entries
      .filter((entry) => entry !== '.git')
      .map((entry) => fs.rm(path.join(cwd, entry), { recursive: true })),
  );
  await writeWorkspace(cwd, recording.workspace.release);

  for (const [directory, names] of Object.entries(recording.componentDirs ?? {})) {
    await Promise.all(
      names.map((name) => fs.mkdir(path.join(cwd, directory, name), { recursive: true })),
    );
  }

  await commit(recording.release);

  return cwd;
}
