import { afterEach, describe, expect, it } from 'vitest';
import loadFonts from './loadFonts';

// A single-glyph (U+41) subset of Roboto, Apache-2.0, 836 bytes. Inlined so the
// tests need no network. Only the descriptors below vary: `FontFace.weight`
// reflects the `@font-face` rule, not the file.
const FONT_SRC = `url(data:font/woff2;base64,d09GMgABAAAAAANEAA8AAAAABnQAAALtAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGhQbbBw0BmA/U1RBVF4APBEMCoEogSwLCAABNgIkAwwEIAWEYgcgG20FyAQe/vXq73tJZgFlqex+ERkoS1UfRucOPv13B/XE/Pw1eSVeLbKp/fvrfHeNiwg64gFX4/HZwmQ2FfAcrA7O704EEI5SFEgWSa+AUKoYjjp2/NS5pK5pb/CS6mgwPaR6VzX5SUUd7PtrtHnMBj/BkxFvqyIJRoAkelEmk8SFxTLF5GooBsY2njKR4NuKyK3U9WIH2oR2SKsBkRXzyiPs8+UkztBrZGAm+hI+pJebJsyYMYGRLDvKxn+WswcdkkpaHJ8RBmuXKGHlWMVgFCkcH36vDNm6tskp8qHV4WwSRQhX0yqvMJAUkIgNBYkURQDDTNdKUSZ2ZOWNelmKQtb2qiReGLXy8ahMAxsqENAZdUkiFgJvAncJvqfTHkxwIEBUKay0DNuAEKCAjU4nxdXWtKI6RzVN7SRShLWHdkapJ9uJFJ1toZ3tHWHtMRvW3jGffbacaFG191L/Tf3T0C71Z6IP2OOiuaP/pv5FZ5fmJzQNZmm0JlNW2bjKzPzKhznXL/WmJFzK7Fcp+3pznl16mXrMOHaAyAkc55UXw9ed3rEiaui34LTgRv7Bx5iK+OyHrTOV36n/noVUBzdeIyYh/izI+z8cQib/Tv0/OaQ6GOe6omxhrfgL2kAyoPdfJIEWgnBhDkMuRXAqDamgqCsi0jQJwoU0SSL5alIwuGdSSedcUOOjfazJRjprjZH0p8JF5BNKnqmQcJIVRZpwUdk2aWF8gXIn0cQqvLhYwwJMXDhw0sR0LBrwtQcXyOW1NOE0pDdRRyODqaQSizpM/Nix8DN4CVQrN2JSMX3YwWwsVmNJUizKmY2Jg2a8rKKB+VK5gUZc7L91aqigimr6MQQdgyoM+jPu9CXy5icwgxlMYMh2K0sLpPCYyzDtNCDA25+rphqduTgxt146SHAm127hxmQNFUbRjAlde30jOkXAwIGr91wzq6lgDRa+lnkLCwdeTJTQSOXCC5cIrzlwuBEWtYbib5Ei4P7KVzk=) format('woff2')`;

const revoke: string[] = [];
let counter = 0;

/** Serves `css` as a real stylesheet, so `loadFonts` can `<link>` to it. */
function stylesheet(css: string) {
  const url = URL.createObjectURL(new Blob([css], { type: 'text/css' }));
  revoke.push(url);
  return url;
}

/** Faces linger in `document.fonts`, so give every test its own family. */
function uniqueFamily() {
  counter += 1;
  return `LoadFontsTest${counter}`;
}

function face(family: string, descriptors: string) {
  return `@font-face { font-family: '${family}'; src: ${FONT_SRC}; ${descriptors} }`;
}

afterEach(() => {
  revoke.splice(0).forEach((url) => URL.revokeObjectURL(url));
});

describe('loadFonts', () => {
  it('resolves when every requested face is declared', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(
      [
        face(family, 'font-weight: 400; font-style: normal;'),
        face(family, 'font-weight: 700; font-style: normal;'),
      ].join('\n'),
    );

    await expect(
      loadFonts({
        stylesheets: [sheet],
        faces: [
          { family, weight: 400 },
          { family, weight: 700 },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects when only a nearby weight is declared', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(
      [
        face(family, 'font-weight: 400; font-style: normal;'),
        face(family, 'font-weight: 700; font-style: normal;'),
      ].join('\n'),
    );

    // CSS font matching resolves 500 to the 400 face, so a presence-only check
    // would pass here.
    await expect(
      loadFonts({ stylesheets: [sheet], faces: [{ family, weight: 500 }] }),
    ).rejects.toThrow(`Missing: ${family} normal 500 (latin)`);
  });

  it('accepts a variable-font weight range', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(face(family, 'font-weight: 100 900; font-style: normal;'));

    // `FontFace.weight` is "100 900" here, not "500".
    await expect(
      loadFonts({ stylesheets: [sheet], faces: [{ family, weight: 500 }] }),
    ).resolves.toBeUndefined();
  });

  it('accepts keyword weight descriptors', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(face(family, 'font-weight: normal; font-style: normal;'));

    await expect(
      loadFonts({ stylesheets: [sheet], faces: [{ family, weight: 400 }] }),
    ).resolves.toBeUndefined();
  });

  it('rejects when the style does not match', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(face(family, 'font-weight: 400; font-style: normal;'));

    await expect(
      loadFonts({ stylesheets: [sheet], faces: [{ family, weight: 400, style: 'italic' }] }),
    ).rejects.toThrow(`Missing: ${family} italic 400 (latin)`);
  });

  it('probes every requested subset', async () => {
    const family = uniqueFamily();
    // Declared for latin only, so the greek probe finds nothing.
    const sheet = stylesheet(
      face(family, 'font-weight: 400; font-style: normal; unicode-range: U+0-FF;'),
    );

    const promise = loadFonts({
      stylesheets: [sheet],
      faces: [{ family, weight: 400 }],
      subsets: [
        { name: 'latin', text: ' ' },
        { name: 'greek', text: 'σ' },
      ],
    });
    await expect(promise).rejects.toThrow(`Missing: ${family} normal 400 (greek)`);
  });

  it('rejects when a stylesheet fails to load', async () => {
    const family = uniqueFamily();

    await expect(
      loadFonts({ stylesheets: ['/does-not-exist.css'], faces: [{ family, weight: 400 }] }),
    ).rejects.toThrow('Failed to load /does-not-exist.css.');
  });

  it('rejects when the font file fails to download', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(
      `@font-face { font-family: '${family}'; src: url(/no-such-font.woff2) format('woff2'); font-weight: 400; font-style: normal; }`,
    );

    await expect(
      loadFonts({ stylesheets: [sheet], faces: [{ family, weight: 400 }] }),
    ).rejects.toThrow(`Missing: ${family} normal 400 (latin)`);
  });

  it('rejects once the timeout elapses', async () => {
    const family = uniqueFamily();
    const sheet = stylesheet(face(family, 'font-weight: 400; font-style: normal;'));
    const original = document.fonts.load;
    // Stub only the hang; everything else stays real.
    document.fonts.load = () => new Promise(() => {});

    try {
      await expect(
        loadFonts({ stylesheets: [sheet], faces: [{ family, weight: 400 }], timeout: 50 }),
      ).rejects.toThrow('Fonts did not load within 50ms.');
    } finally {
      document.fonts.load = original;
    }
  });
});
