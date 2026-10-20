/**
 * Generates `src/pipeline/resolveServerMdnLink/mdnTypeLinks.ts`.
 *
 * Interfaces and global objects come from `@mdn/browser-compat-data`. Types that only
 * exist in TypeScript's lib files, such as `Intl.NumberFormatOptions`, link to the MDN
 * section of the parameter they are used for, such as the `options` parameter of the
 * `Intl.NumberFormat()` constructor. Those sections are checked against the live MDN
 * pages, so generating needs network access.
 *
 * Run with `pnpm -F @mui/internal-docs-infra generate:mdn-type-links` after bumping
 * `@mdn/browser-compat-data` or `typescript`.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as prettier from 'prettier';
import ts from 'typescript';
import bcd from '@mdn/browser-compat-data' with { type: 'json' };
import type { Identifier } from '@mdn/browser-compat-data';

const MDN_URL_PREFIX = 'https://developer.mozilla.org/docs/';

const OUTPUT_FILE = new URL(
  '../src/pipeline/resolveServerMdnLink/mdnTypeLinks.ts',
  import.meta.url,
);

/**
 * Globals that only exist as values, never as type names.
 */
const VALUE_ONLY_GLOBALS = new Set(['Infinity', 'NaN']);

/**
 * Types used by too many parameters to pick one automatically, mapped to the MDN
 * section that explains them.
 */
const OVERRIDES: Record<string, string> = {
  'Intl.LocalesArgument': `${MDN_URL_PREFIX}Web/JavaScript/Reference/Global_Objects/Intl#locales_argument`,
};

function isTypeName(name: string): boolean {
  return /^[A-Z]/.test(name) && !VALUE_ONLY_GLOBALS.has(name);
}

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
 * Collects the interfaces and global objects that have an MDN page of their own.
 */
function collectPageLinks(): Record<string, string> {
  const links: Record<string, string> = {};

  for (const [name, identifier] of [
    ...getMembers(bcd.api),
    ...getMembers(bcd.javascript.builtins),
  ]) {
    const url = getMdnUrl(identifier);
    if (!isTypeName(name) || !url) {
      continue;
    }
    links[name] = url;

    // Namespaced objects such as `Intl.NumberFormat` or `Temporal.PlainDate`
    for (const [memberName, member] of getMembers(identifier)) {
      const memberUrl = getMdnUrl(member);
      if (
        isTypeName(memberName) &&
        memberName !== name &&
        memberUrl?.endsWith(`/${name}/${memberName}`)
      ) {
        links[`${name}.${memberName}`] = memberUrl;
      }
    }
  }

  return links;
}

type ParameterUsage = {
  /** MDN page of the method or constructor that takes the parameter. */
  url: string;
  /** Candidate section ids on that page, most likely first. */
  anchors: string[];
  /** Name of the owning interface and of the method, used to rank usages. */
  names: string[];
};

type LibAnalysis = {
  /** Parameters typed with each lib-only type, whose method or constructor has an MDN page. */
  usages: Map<string, ParameterUsage[]>;
  /** Lib-only aliases of another named type, such as `WindowProxy` for `Window`. */
  aliases: Map<string, string>;
};

/**
 * Analyzes the types declared only in TypeScript's lib files.
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
    for (const parameter of parameters) {
      if (!ts.isIdentifier(parameter.name)) {
        continue;
      }
      for (const reference of getReferences(parameter.type)) {
        const symbol = checker.getSymbolAtLocation(reference.typeName);
        if (!symbol || !isLibOnlyType(symbol)) {
          continue;
        }
        const typeName = checker.getFullyQualifiedName(symbol);
        const shortName = typeName.slice(typeName.lastIndexOf('.') + 1);
        usages.set(typeName, [
          ...(usages.get(typeName) ?? []),
          {
            url,
            // MDN usually names the section after the parameter, and calls dictionaries `options`.
            anchors: [parameter.name.text.toLowerCase(), shortName.toLowerCase(), 'options'],
            names: [ownerPath[ownerPath.length - 1], member],
          },
        ]);
      }
    }
  }

  const aliases = new Map<string, string>();

  function visit(node: ts.Node, namespace: string[]) {
    if (ts.isTypeAliasDeclaration(node) && ts.isTypeReferenceNode(node.type)) {
      const target = checker.getSymbolAtLocation(node.type.typeName);
      if (target) {
        aliases.set(
          [...namespace, node.name.text].join('.'),
          checker.getFullyQualifiedName(target),
        );
      }
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      const inner = [...namespace, node.name.text];
      node.body.forEachChild((child) => visit(child, inner));
    } else if (ts.isModuleBlock(node)) {
      node.forEachChild((child) => visit(child, namespace));
    } else if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
          record([...namespace, name], member.name.text, member.parameters);
        } else if (ts.isConstructSignatureDeclaration(member) && name.endsWith('Constructor')) {
          const owner = name.slice(0, -'Constructor'.length);
          record([...namespace, owner], owner, member.parameters);
        }
      }
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

  return { usages, aliases };
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

/**
 * Fetches each MDN page once and returns the section ids it contains.
 */
async function fetchSectionIds(urls: string[]): Promise<Map<string, Set<string>>> {
  const sections = new Map<string, Set<string>>();
  const queue = [...new Set(urls)];

  // A few workers drain the queue one page at a time to stay polite to MDN.
  async function worker() {
    for (let url = queue.pop(); url; url = queue.pop()) {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(
        url.replace(MDN_URL_PREFIX, 'https://developer.mozilla.org/en-US/docs/'),
      );
      if (!response.ok) {
        throw new Error(`Fetching ${url} failed with ${response.status}`);
      }
      // eslint-disable-next-line no-await-in-loop
      const html = await response.text();
      sections.set(url, new Set(Array.from(html.matchAll(/ id="([^"]+)"/g), (match) => match[1])));
    }
  }

  await Promise.all(Array.from({ length: 8 }, worker));
  return sections;
}

async function collectLinks(): Promise<Record<string, string>> {
  const links = collectPageLinks();
  const { usages: parameterUsages, aliases } = analyzeLibFiles();

  for (const [alias, target] of aliases) {
    if (!(alias in links) && target in links) {
      links[alias] = links[target];
    }
  }

  const picked = new Map<string, ParameterUsage>();
  for (const [typeName, usages] of parameterUsages) {
    const usage =
      typeName in links || typeName in OVERRIDES ? undefined : pickUsage(typeName, usages);
    if (usage) {
      picked.set(typeName, usage);
    }
  }

  const overrideUrls = Object.values(OVERRIDES);
  const sections = await fetchSectionIds([
    ...Array.from(picked.values(), (usage) => usage.url),
    ...overrideUrls.map((url) => url.slice(0, url.indexOf('#'))),
  ]);

  for (const [typeName, usage] of picked) {
    const anchor = usage.anchors.find((candidate) => sections.get(usage.url)?.has(candidate));
    links[typeName] = anchor ? `${usage.url}#${anchor}` : usage.url;
  }

  for (const [typeName, url] of Object.entries(OVERRIDES)) {
    const [page, anchor] = url.split('#');
    if (!sections.get(page)?.has(anchor)) {
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
// Data from @mdn/browser-compat-data ${bcdVersion} and typescript ${ts.version}.

/**
 * Maps global type names (e.g. \`HTMLElement\`, \`Intl.NumberFormatOptions\`) to their MDN page.
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
