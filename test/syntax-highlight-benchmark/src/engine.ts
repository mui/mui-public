import type { Root } from 'hast';
import type { Category } from './categories';
import type { Language } from './languages';

export type Categorize = (className: string, text: string, language: Language) => Category;

export interface Engine {
  name: string;
  version: string;
  /** Loads the engine and every language docs-infra supports. */
  init(): Promise<void>;
  /** Highlights `source` into HAST: one `<span class>` per token, plain text otherwise. */
  highlight(source: string, language: Language): Root;
  /** Maps a token class name (and its text) to a shared category. */
  categorize: Categorize;
  /** Languages the engine only approximates, with how. */
  fallbacks: Partial<Record<Language, string>>;
}
