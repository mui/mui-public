/**
 * Generates `src/pipeline/resolveServerMdnLink/mdnTypeLinks.ts`, a map from the types declared in
 * TypeScript's lib files to their MDN page.
 *
 * - Interfaces and global objects link to their page in `@mdn/browser-compat-data`.
 * - Aliases of another type, such as `WindowProxy`, link to that type's page.
 * - Other types, such as `Intl.NumberFormatOptions`, link to the section of the parameter they
 *   describe, read from the MDN source in `mdn/content` at `MDN_CONTENT_COMMIT`.
 *
 * Run with `pnpm -F @mui/internal-docs-infra generate:mdn-type-links` after bumping
 * `@mdn/browser-compat-data`, `typescript`, or `MDN_CONTENT_COMMIT`. Reading `mdn/content` needs
 * network access, but the output only depends on these three inputs.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as prettier from 'prettier';
import ts from 'typescript';
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import type { Identifier } from '@mdn/browser-compat-data';

const MDN_CONTENT_COMMIT = '6c2954d3490bd0f445547e1ec359684c5cb36712';

const MDN_URL_PREFIX = 'https://developer.mozilla.org/docs/';

const OUTPUT_FILE = new URL(
  '../src/pipeline/resolveServerMdnLink/mdnTypeLinks.ts',
  import.meta.url,
);

/**
 * Types used by too many parameters to pick one automatically, mapped to the MDN section that
 * explains them.
 */
const OVERRIDES: Record<string, string> = {
  'Intl.LocalesArgument': `${MDN_URL_PREFIX}Web/JavaScript/Reference/Global_Objects/Intl#locales_argument`,
};

/**
 * Lists the child features of `identifier`, without its own `__compat` statement.
 */
function getMembers(identifier: Identifier): [string, Identifier][] {
  return Object.entries(identifier).filter(
    (entry): entry is [string, Identifier] => entry[0] !== '__compat',
  );
}

function getMdnUrl(identifier: Identifier | undefined): string | undefined {
  // eslint-disable-next-line no-underscore-dangle
  const url = identifier?.__compat?.mdn_url;
  return url?.startsWith(MDN_URL_PREFIX) ? url : undefined;
}

/**
 * Returns the MDN page of a type that BCD documents under the same name, such as `HTMLElement`
 * or `Intl.NumberFormat`.
 */
function findTypePage(typeName: string): string | undefined {
  const [first, ...rest] = typeName.split('.');
  if (rest.length === 0) {
    return getMdnUrl(bcd.api[first]) ?? getMdnUrl(bcd.javascript.builtins[first]);
  }
  // Namespaced objects such as `Intl.NumberFormat` are documented under their namespace.
  const member = rest.length === 1 ? bcd.javascript.builtins[first]?.[rest[0]] : undefined;
  const url = getMdnUrl(member as Identifier | undefined);
  return url?.endsWith(`/${first}/${rest[0]}`) ? url : undefined;
}

type ParameterUsage = {
  /** MDN page of the method or constructor that takes the parameter. */
  url: string;
  /** Name of the parameter in TypeScript's lib files. */
  parameterName: string;
  /** Position of the parameter, and how many parameters the signature has. */
  parameterIndex: number;
  parameterCount: number;
  /** Names of the owning interface and of the method, used to rank usages. */
  names: string[];
};

type LibAnalysis = {
  /** Names of the interfaces, type aliases, and classes declared only in lib files. */
  typeNames: Set<string>;
  /** Aliases of another named type, such as `WindowProxy` for `Window`. */
  aliases: Map<string, string>;
  /** Parameters typed with each lib type, whose method or constructor has an MDN page. */
  usages: Map<string, ParameterUsage[]>;
};

/**
 * Analyzes the types declared in TypeScript's lib files.
 */
function analyzeLibFiles(): LibAnalysis {
  const libDirectory = path.dirname(ts.getDefaultLibFilePath({}));
  const program = ts.createProgram([path.join(libDirectory, 'lib.esnext.full.d.ts')], {
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const libFiles = program
    .getSourceFiles()
    .filter((sourceFile) => sourceFile.fileName.startsWith(libDirectory));

  // Mixins such as `HTMLOrSVGElement` have no MDN page; their members are documented on the
  // interfaces that extend them.
  const extenders = new Map<string, string[]>();
  for (const sourceFile of libFiles) {
    for (const statement of sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement)) {
        for (const heritage of statement.heritageClauses ?? []) {
          for (const base of heritage.types) {
            const baseName = base.expression.getText(sourceFile);
            extenders.set(baseName, [...(extenders.get(baseName) ?? []), statement.name.text]);
          }
        }
      }
    }
  }

  function findMemberUrl(ownerPath: string[], member: string): string | undefined {
    const [first, ...rest] = ownerPath;
    let node: Identifier | undefined = bcd.api[first] ?? bcd.javascript.builtins[first];
    for (const segment of [...rest, member]) {
      node = node?.[segment] as Identifier | undefined;
    }
    const url = getMdnUrl(node);
    if (url || ownerPath.length > 1) {
      return url;
    }
    return [...(extenders.get(first) ?? [])]
      .sort()
      .map((extender) => getMdnUrl(bcd.api[extender]?.[member] as Identifier | undefined))
      .find(Boolean);
  }

  function isLibOnlyType(symbol: ts.Symbol): boolean {
    const declarations = symbol.declarations ?? [];
    return (
      // eslint-disable-next-line no-bitwise
      (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) !== 0 &&
      declarations.length > 0 &&
      declarations.every((declaration) => libFiles.includes(declaration.getSourceFile()))
    );
  }

  function getReferences(typeNode: ts.TypeNode | undefined): ts.TypeReferenceNode[] {
    if (!typeNode) {
      return [];
    }
    if (ts.isTypeReferenceNode(typeNode)) {
      return [typeNode];
    }
    if (ts.isUnionTypeNode(typeNode)) {
      return typeNode.types.flatMap(getReferences);
    }
    return ts.isParenthesizedTypeNode(typeNode) ? getReferences(typeNode.type) : [];
  }

  const typeNames = new Set<string>();
  const aliases = new Map<string, string>();
  const usages = new Map<string, ParameterUsage[]>();

  function record(
    ownerPath: string[],
    member: string,
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
  ) {
    const url = findMemberUrl(ownerPath, member);
    if (!url) {
      return;
    }
    parameters.forEach((parameter, parameterIndex) => {
      if (!ts.isIdentifier(parameter.name)) {
        return;
      }
      for (const reference of getReferences(parameter.type)) {
        const symbol = checker.getSymbolAtLocation(reference.typeName);
        if (!symbol || !isLibOnlyType(symbol)) {
          continue;
        }
        const typeName = checker.getFullyQualifiedName(symbol);
        usages.set(typeName, [
          ...(usages.get(typeName) ?? []),
          {
            url,
            parameterName: parameter.name.text,
            parameterIndex,
            parameterCount: parameters.length,
            names: [ownerPath[ownerPath.length - 1], member],
          },
        ]);
      }
    });
  }

  function visit(node: ts.Node, namespace: string[]) {
    if (ts.isTypeAliasDeclaration(node)) {
      const name = [...namespace, node.name.text].join('.');
      typeNames.add(name);
      if (ts.isTypeReferenceNode(node.type)) {
        const target = checker.getSymbolAtLocation(node.type.typeName);
        if (target) {
          aliases.set(name, checker.getFullyQualifiedName(target));
        }
      }
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      const inner = [...namespace, node.name.text];
      node.body.forEachChild((child) => visit(child, inner));
    } else if (ts.isModuleBlock(node)) {
      node.forEachChild((child) => visit(child, namespace));
    } else if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      typeNames.add([...namespace, name].join('.'));
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
          record([...namespace, name], member.name.text, member.parameters);
        } else if (ts.isConstructSignatureDeclaration(member) && name.endsWith('Constructor')) {
          const owner = name.slice(0, -'Constructor'.length);
          record([...namespace, owner], owner, member.parameters);
        }
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      typeNames.add([...namespace, node.name.text].join('.'));
    } else if (ts.isVariableStatement(node)) {
      // `declare var IntersectionObserver: { new (...): IntersectionObserver }`
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.type &&
          ts.isTypeLiteralNode(declaration.type)
        ) {
          const owner = declaration.name.text;
          for (const member of declaration.type.members) {
            if (ts.isConstructSignatureDeclaration(member)) {
              record([...namespace, owner], owner, member.parameters);
            }
          }
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      // Global functions such as `fetch` are documented on `Window`.
      record(namespace.length > 0 ? namespace : ['Window'], node.name.text, node.parameters);
    }
  }

  for (const sourceFile of libFiles) {
    sourceFile.forEachChild((child) => visit(child, []));
  }

  return { typeNames, aliases, usages };
}

/**
 * Picks the usage that best explains a type: the method or interface whose name starts the
 * type's name (`addEventListener` for `AddEventListenerOptions`), or the only usage there is.
 */
function pickUsage(typeName: string, usages: ParameterUsage[]): ParameterUsage | undefined {
  const shortName = typeName.slice(typeName.lastIndexOf('.') + 1).toLowerCase();
  const ranked = usages
    .map((usage) => ({
      usage,
      score: Math.max(
        ...usage.names.map((name) => (shortName.startsWith(name.toLowerCase()) ? name.length : 0)),
      ),
    }))
    .sort(
      (left, right) => right.score - left.score || left.usage.url.localeCompare(right.usage.url),
    );

  if (ranked[0].score > 0) {
    return ranked[0].usage;
  }
  return new Set(usages.map((usage) => usage.url)).size === 1 ? usages[0] : undefined;
}

type MdnPage = {
  /** Parameter names in the order the page lists them, lowercased like MDN's section ids. */
  parameters: string[];
  /** Ids of the page's headings. */
  headings: Set<string>;
};

/**
 * Returns where `mdn/content` stores the source of an MDN page.
 */
function getContentPath(url: string): string {
  const slug = url
    .slice(MDN_URL_PREFIX.length)
    .toLowerCase()
    .replaceAll('::', '_doublecolon_')
    .replaceAll(':', '_colon_')
    .replaceAll('*', '_star_')
    .replaceAll('?', '_question_');
  return `files/en-us/${slug}/index.md`;
}

/**
 * Reads the parameter list and headings from the source of an MDN page.
 */
function parseMdnPage(markdown: string): MdnPage {
  const parameters: string[] = [];
  const headings = new Set<string>();
  let inParameters = false;

  for (const line of markdown.split('\n')) {
    const heading = /^#{2,6} (.+)$/.exec(line);
    if (heading) {
      const text = heading[1].trim();
      headings.add(text.replaceAll('`', '').toLowerCase().replaceAll(' ', '_'));
      inParameters = text === 'Parameters' || text === 'Values';
      continue;
    }
    // Only plain names, since MDN derives the section id from the listed text.
    const parameter = inParameters ? /^- `([\w$]+)`/.exec(line) : null;
    if (parameter) {
      parameters.push(parameter[1].toLowerCase());
    }
  }

  return { parameters, headings };
}

/**
 * Fetches the source of each MDN page at `MDN_CONTENT_COMMIT`. Pages missing from `mdn/content`
 * are left out.
 */
async function fetchMdnPages(urls: string[]): Promise<Map<string, MdnPage>> {
  const pages = new Map<string, MdnPage>();
  const queue = [...new Set(urls)];

  // A few workers drain the queue one page at a time to stay polite to GitHub.
  async function worker() {
    for (let url = queue.pop(); url; url = queue.pop()) {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(
        `https://raw.githubusercontent.com/mdn/content/${MDN_CONTENT_COMMIT}/${getContentPath(url)}`,
      );
      if (response.status === 404) {
        continue;
      }
      if (!response.ok) {
        throw new Error(`Fetching the MDN source of ${url} failed with ${response.status}`);
      }
      // eslint-disable-next-line no-await-in-loop
      pages.set(url, parseMdnPage(await response.text()));
    }
  }

  await Promise.all(Array.from({ length: 8 }, worker));
  return pages;
}

/**
 * Finds the MDN section of a parameter: the one with the TypeScript parameter's name, the one in
 * the same position when both list the same number of parameters, or `options`.
 */
function findParameterSection(
  usage: ParameterUsage,
  page: MdnPage | undefined,
): string | undefined {
  if (!page) {
    return undefined;
  }
  const name = usage.parameterName.toLowerCase();
  if (page.parameters.includes(name)) {
    return name;
  }
  if (page.parameters.length === usage.parameterCount) {
    return page.parameters[usage.parameterIndex];
  }
  return page.parameters.includes('options') ? 'options' : undefined;
}

async function collectLinks(): Promise<Record<string, string>> {
  const { typeNames, aliases, usages } = analyzeLibFiles();
  const links: Record<string, string> = {};

  for (const typeName of typeNames) {
    const url = findTypePage(typeName);
    if (url) {
      links[typeName] = url;
    }
  }

  for (const [alias, target] of aliases) {
    if (!(alias in links) && target in links) {
      links[alias] = links[target];
    }
  }

  const picked = new Map<string, ParameterUsage>();
  for (const [typeName, typeUsages] of usages) {
    const usage =
      typeName in links || typeName in OVERRIDES ? undefined : pickUsage(typeName, typeUsages);
    if (usage) {
      picked.set(typeName, usage);
    }
  }

  const overridePages = Object.values(OVERRIDES).map((url) => url.slice(0, url.indexOf('#')));
  const pages = await fetchMdnPages([
    ...Array.from(picked.values(), (usage) => usage.url),
    ...overridePages,
  ]);

  for (const [typeName, usage] of picked) {
    const section = findParameterSection(usage, pages.get(usage.url));
    links[typeName] = section ? `${usage.url}#${section}` : usage.url;
  }

  for (const [typeName, url] of Object.entries(OVERRIDES)) {
    const [page, section] = url.split('#');
    if (!pages.get(page)?.headings.has(section)) {
      throw new Error(`The override for ${typeName} points to a missing section: ${url}`);
    }
    links[typeName] = url;
  }

  return Object.fromEntries(
    Object.entries(links).sort(([nameA], [nameB]) => (nameA < nameB ? -1 : 1)),
  );
}

async function main() {
  const links = await collectLinks();
  // eslint-disable-next-line no-underscore-dangle
  const bcdVersion = bcd.__meta.version;
  const source = `// This file is generated by scripts/generateMdnTypeLinks.mts. Do not edit it manually.
// Data from @mdn/browser-compat-data ${bcdVersion}, typescript ${ts.version}, and mdn/content ${MDN_CONTENT_COMMIT}.

/**
 * Maps types declared in TypeScript's lib files (e.g. \`HTMLElement\`, \`Intl.NumberFormatOptions\`)
 * to their MDN page.
 */
export const MDN_TYPE_LINKS: Record<string, string> = ${JSON.stringify(links)};
`;

  const filepath = OUTPUT_FILE.pathname;
  const config = await prettier.resolveConfig(filepath);
  await fs.writeFile(OUTPUT_FILE, await prettier.format(source, { ...config, filepath }));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${Object.keys(links).length} links to ${filepath}`);
}

await main();
