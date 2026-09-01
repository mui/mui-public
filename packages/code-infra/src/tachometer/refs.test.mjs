import { describe, expect, it } from 'vitest';
import { parseRefToken } from './refs.mjs';

describe('parseRefToken', () => {
  it('treats an absent ref as the working tree', () => {
    expect(parseRefToken(undefined)).toEqual({ kind: 'worktree' });
  });

  it('treats an empty ref as the working tree', () => {
    expect(parseRefToken('')).toEqual({ kind: 'worktree' });
  });

  it('recognises the baseline symbol', () => {
    expect(parseRefToken('baseline')).toEqual({ kind: 'baseline' });
  });

  it('parses a git revision', () => {
    expect(parseRefToken('git:abc1234')).toEqual({ kind: 'git', committish: 'abc1234' });
  });

  it('keeps the whole revision, including characters that look like a scheme', () => {
    expect(parseRefToken('git:origin/master')).toEqual({
      kind: 'git',
      committish: 'origin/master',
    });
  });

  describe('reserved schemes', () => {
    it.each(['github:owner/repo#abc1234', 'preview:abc1234'])(
      'reports %s as recognised but not implemented',
      (token) => {
        expect(() => parseRefToken(token)).toThrow(/recognised but not implemented/);
      },
    );
  });

  describe('unknown tokens', () => {
    it('suggests the git scheme for a bare revision-shaped value', () => {
      expect(() => parseRefToken('HEAD~1')).toThrow(/did you mean "git:HEAD~1"\?/);
    });

    it('does not suggest the git scheme for a value that cannot be a revision', () => {
      // A bare value is never auto-prefixed, since an absent ref already means "working tree".
      expect(() => parseRefToken('what is this')).toThrow(/Unknown ref "what is this"/);
      expect(() => parseRefToken('what is this')).not.toThrow(/did you mean/);
    });
  });
});
