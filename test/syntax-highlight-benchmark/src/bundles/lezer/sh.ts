import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';

export const sh = StreamLanguage.define(shell).parser;
