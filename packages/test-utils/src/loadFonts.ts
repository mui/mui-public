export interface FontFaceSpec {
  family: string;
  weight: number;
  /** Defaults to `normal`. */
  style?: string;
}

export interface FontSubset {
  /** Named in the error message, e.g. `greek`. */
  name: string;
  /** One character inside the subset's `unicode-range`. */
  text: string;
}

export interface LoadFontsOptions {
  /** Stylesheets declaring the faces, injected as `<link rel="stylesheet">`. */
  stylesheets: string[];
  faces: FontFaceSpec[];
  /**
   * Google splits every face into `unicode-range` subsets, and `load()` only
   * fetches the ones covering its text. Name a character per subset the fixtures
   * render, otherwise a broken subset file goes unnoticed. Defaults to latin.
   */
  subsets?: FontSubset[];
  /** Milliseconds to wait before giving up. Defaults to 20000. */
  timeout?: number;
}

const DEFAULT_SUBSETS: FontSubset[] = [{ name: 'latin', text: ' ' }];
const DEFAULT_TIMEOUT = 20000;

function loadStylesheet(href: string) {
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.addEventListener('load', () => resolve());
    link.addEventListener('error', () => reject(new Error(`Failed to load ${href}.`)));
    document.head.appendChild(link);
  });
}

async function loadFaces(options: LoadFontsOptions) {
  const { stylesheets, faces, subsets = DEFAULT_SUBSETS } = options;

  // `document.fonts` only matches `@font-face` rules that are already parsed.
  await Promise.all(stylesheets.map(loadStylesheet));

  // A `<link>` alone does not download the font, because no element renders the
  // family yet. `document.fonts.status` reports `loaded` for that empty pending
  // set, so gating on it cannot see a failure. `load()` forces the download.
  const missing: string[] = [];
  await Promise.all(
    faces.flatMap(({ family, weight, style = 'normal' }) =>
      subsets.map(async ({ name, text }) => {
        const label = `${family} ${style} ${weight} (${name})`;
        try {
          // `load()` applies normal CSS matching, so a request for a weight the
          // stylesheet omits resolves to the nearest one. Compare what came back.
          const matched = await document.fonts.load(`${style} ${weight} 16px "${family}"`, text);
          if (!matched.some((face) => face.weight === String(weight) && face.style === style)) {
            missing.push(label);
          }
        } catch {
          // The rule matched but the font file failed to download.
          missing.push(label);
        }
      }),
    ),
  );

  if (missing.length > 0) {
    throw new Error(`Fonts failed to load. Missing: ${missing.join(', ')}`);
  }
}

// Callers may install Sinon fake timers before this runs, and `runToLast()`
// would fire a `setTimeout` at once. `AbortSignal.timeout` is not faked, so it
// still measures real time.
function rejectAfter(ms: number) {
  return new Promise<never>((_, reject) => {
    AbortSignal.timeout(ms).addEventListener('abort', () => {
      reject(new Error(`Fonts did not load within ${ms}ms.`));
    });
  });
}

/**
 * Loads the webfonts a visual-regression bundle renders with.
 *
 * A screenshot taken with a fallback face looks like a repo-wide text rendering
 * change, so callers should await this before capturing anything and let the
 * rejection fail the run.
 *
 * @returns a promise that rejects when a face does not load.
 */
export default function loadFonts(options: LoadFontsOptions): Promise<void> {
  return Promise.race([loadFaces(options), rejectAfter(options.timeout ?? DEFAULT_TIMEOUT)]);
}
