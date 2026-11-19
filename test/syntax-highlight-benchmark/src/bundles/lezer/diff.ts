import { StreamLanguage } from '@codemirror/language';
import { diff } from '@codemirror/legacy-modes/mode/diff';

export const diffParser = StreamLanguage.define(diff).parser;
