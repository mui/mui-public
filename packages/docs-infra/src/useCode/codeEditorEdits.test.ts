import { describe, expect, it } from 'vitest';
import { indentEdit, outdentEdit } from './codeEditorEdits';

/** Applies an edit the way the textarea would, for readable assertions. */
function apply(source: string, edit: ReturnType<typeof indentEdit>) {
  if (!edit) {
    return null;
  }
  return `${source.slice(0, edit.start)}${edit.text}${source.slice(edit.end)}`;
}

describe('indentEdit', () => {
  it('aligns a caret to the next tab stop', () => {
    const edit = indentEdit('const a = 1;', 0, 0, 2)!;
    expect(apply('const a = 1;', edit)).toBe('  const a = 1;');
    expect(edit.selectionStart).toBe(2);
  });

  it('inserts only the remaining distance to the tab stop', () => {
    // Caret at column 1 needs a single space to reach column 2.
    const edit = indentEdit('x', 1, 1, 2)!;
    expect(edit.text).toBe(' ');
    expect(edit.selectionStart).toBe(2);
  });

  it('indents every line of a multi-line selection', () => {
    const source = 'first\nsecond\nthird';
    const edit = indentEdit(source, 2, 9, 2)!;
    expect(apply(source, edit)).toBe('  first\n  second\nthird');
  });

  it('keeps the indented block selected', () => {
    const source = 'first\nsecond';
    const edit = indentEdit(source, 0, source.length, 2)!;
    expect(edit.selectionStart).toBe(0);
    expect(edit.selectionEnd).toBe('  first\n  second'.length);
  });

  it('leaves blank lines untouched', () => {
    const source = 'first\n\nthird';
    const edit = indentEdit(source, 0, source.length, 2)!;
    expect(apply(source, edit)).toBe('  first\n\n  third');
  });
});

describe('outdentEdit', () => {
  it('removes one level of indentation from a caret line', () => {
    const source = '    const a = 1;';
    const edit = outdentEdit(source, 6, 6, 2)!;
    expect(apply(source, edit)).toBe('  const a = 1;');
    expect(edit.selectionStart).toBe(4);
  });

  it('removes fewer spaces when the line has less than a full level', () => {
    const source = ' x';
    const edit = outdentEdit(source, 2, 2, 2)!;
    expect(apply(source, edit)).toBe('x');
  });

  it('outdents every line of a multi-line selection', () => {
    const source = '  first\n    second';
    const edit = outdentEdit(source, 0, source.length, 2)!;
    expect(apply(source, edit)).toBe('first\n  second');
  });

  it('returns null when nothing can be removed', () => {
    expect(outdentEdit('first\nsecond', 0, 12, 2)).toBeNull();
  });

  it('does not pull the caret before its line start', () => {
    const source = '  x';
    const edit = outdentEdit(source, 1, 1, 2)!;
    expect(edit.selectionStart).toBe(0);
  });

  it('only removes spaces, never source characters', () => {
    const source = ' \tx';
    const edit = outdentEdit(source, 3, 3, 2)!;
    expect(apply(source, edit)).toBe('\tx');
  });
});
