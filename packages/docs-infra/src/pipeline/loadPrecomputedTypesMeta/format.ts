/* eslint-disable no-await-in-loop */
import * as tae from 'typescript-api-extractor';
import { uniq, sortBy } from 'es-toolkit';
import * as prettier from 'prettier';

async function prettyFormat(type: string, typeName?: string) {
  const formattedType = await prettier.format(`type ${typeName || '_'} = ${type}`, {
    parser: 'typescript',
    singleQuote: true,
    semi: false,
    printWidth: 60,
  });

  // Improve readability by formatting complex types with Prettier.
  // Prettier either formats the type on a single line or multiple lines.
  // If it's on a single line, we remove the `type _ = ` prefix.
  // If it's on multiple lines, we remove the first line (`type _ =`) and de-indent the rest.
  const lines = formattedType?.trimEnd().split('\n') ?? [];
  if (lines.length === 1) {
    type = lines[0].replace(/^type _ = /, '');
  } else {
    const codeLines = typeName ? lines : lines.slice(1);
    const nonEmptyLines = codeLines.filter((l) => l.trim() !== '');
    if (nonEmptyLines.length > 0) {
      const minIndent = Math.min(...nonEmptyLines.map((l) => l.match(/^\s*/)?.[0].length ?? 0));

      if (Number.isFinite(minIndent) && minIndent > 0) {
        type = codeLines.map((l) => l.substring(minIndent)).join('\n');
      } else {
        type = codeLines.join('\n');
      }
    } else {
      type = codeLines.join('\n');
    }
  }

  return type;
}

export async function formatProperties(
  props: tae.PropertyNode[],
  exportNames: string[],
  allExports: tae.ExportNode[] | undefined = undefined,
) {
  const result: Record<string, any> = {};

  for (const prop of props) {
    const exampleTag = prop.documentation?.tags
      ?.filter((tag) => tag.name === 'example')
      .map((tag) => tag.value)
      .join('\n');

    let detailedType = formatType(
      prop.type,
      prop.optional,
      prop.documentation?.tags,
      false,
      exportNames,
    );
    if (prop.name !== 'className' && prop.name !== 'render' && allExports) {
      detailedType = formatDetailedType(prop.type, allExports, exportNames);
    }

    detailedType = await prettyFormat(detailedType);

    const formattedType = formatType(
      prop.type,
      prop.optional,
      prop.documentation?.tags,
      false,
      exportNames,
    );

    const resultObject: Record<string, any> = {
      type: formattedType,
      default: prop.documentation?.defaultValue,
      required: !prop.optional || undefined,
      description: prop.documentation?.description,
      example: exampleTag || undefined,
      detailedType,
    };

    if (detailedType === formattedType) {
      delete resultObject.detailedType;
    }

    result[prop.name] = resultObject;
  }

  return result;
}

export function formatParameters(params: tae.Parameter[], exportNames: string[] = []) {
  const result: Record<string, any> = {};

  for (const param of params) {
    const exampleTag = param.documentation?.tags
      ?.filter((tag) => tag.name === 'example')
      .map((tag) => tag.value)
      .join('\n');

    result[param.name] = {
      type: formatType(param.type, param.optional, param.documentation?.tags, true, exportNames),
      default: param.defaultValue,
      optional: param.optional || undefined,
      description: param.documentation?.description,
      example: exampleTag || undefined,
    };
  }

  return result;
}

export function formatDetailedType(
  type: tae.AnyType,
  allExports: tae.ExportNode[],
  exportNames: string[],
  visited = new Set<string>(),
): string {
  // Prevent infinite recursion
  if (type instanceof tae.ExternalTypeNode) {
    const qualifiedName = getFullyQualifiedName(type.typeName, exportNames);
    if (visited.has(qualifiedName)) {
      return qualifiedName;
    }
    visited.add(qualifiedName);

    const exportNode = allExports.find((node) => node.name === type.typeName.name);
    if (exportNode) {
      return formatDetailedType(
        (exportNode.type as unknown as tae.AnyType) ?? type,
        allExports,
        exportNames,
        visited,
      );
    }

    // Manually expand known external aliases when declaration is not in local exports
    switch (true) {
      case qualifiedName.endsWith('Padding'):
        return '{ top?: number; right?: number; bottom?: number; left?: number } | number';
      default:
        return qualifiedName;
    }
  }

  if (type instanceof tae.UnionNode) {
    const memberTypes = type.types.map((t) =>
      formatDetailedType(t, allExports, exportNames, visited),
    );
    return uniq(memberTypes).join(' | ');
  }

  if (type instanceof tae.IntersectionNode) {
    const memberTypes = type.types.map((t) =>
      formatDetailedType(t, allExports, exportNames, visited),
    );
    return uniq(memberTypes).join(' & ');
  }

  // For objects and everything else, reuse existing formatter with object expansion enabled
  return formatType(type, false, undefined, true, exportNames);
}

export function formatEnum(enumNode: tae.EnumNode) {
  const result: Record<string, any> = {};
  for (const member of sortBy(enumNode.members, ['value'])) {
    result[member.value] = {
      description: member.documentation?.description,
      type: member.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
    };
  }

  return result;
}

export function formatType(
  type: tae.AnyType,
  removeUndefined: boolean,
  jsdocTags: tae.DocumentationTag[] | undefined = undefined,
  expandObjects: boolean = false,
  exportNames: string[] = [],
): string {
  const typeTag = jsdocTags?.find?.((tag) => tag.name === 'type');
  const typeValue = typeTag?.value;

  if (typeValue) {
    return typeValue;
  }

  if (type instanceof tae.ExternalTypeNode) {
    if (/^ReactElement(<.*>)?/.test(type.typeName.name || '')) {
      return 'ReactElement';
    }

    if (type.typeName.namespaces?.length === 1 && type.typeName.namespaces[0] === 'React') {
      return createNameWithTypeArguments(type.typeName, exportNames);
    }

    return getFullyQualifiedName(type.typeName, exportNames);
  }

  if (type instanceof tae.IntrinsicNode) {
    return type.typeName ? getFullyQualifiedName(type.typeName, exportNames) : type.intrinsic;
  }

  if (type instanceof tae.UnionNode) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    let memberTypes = type.types;

    if (removeUndefined) {
      memberTypes = memberTypes.filter(
        (t) => !(t instanceof tae.IntrinsicNode && t.intrinsic === 'undefined'),
      );
    }

    // Deduplicates types in unions.
    // Plain unions are handled by TypeScript API Extractor, but we also display unions in type parameters constraints,
    // so we need to merge those here.
    const flattenedMemberTypes = memberTypes.flatMap((t) => {
      if (t instanceof tae.UnionNode) {
        return t.typeName ? t : t.types;
      }

      if (t instanceof tae.TypeParameterNode && t.constraint instanceof tae.UnionNode) {
        return t.constraint.types;
      }

      return t;
    });

    const formattedMemeberTypes = uniq(
      orderMembers(flattenedMemberTypes).map((t) =>
        formatType(t, removeUndefined, undefined, expandObjects, exportNames),
      ),
    );

    return formattedMemeberTypes.join(' | ');
  }

  if (type instanceof tae.IntersectionNode) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    return orderMembers(type.types)
      .map((t) => formatType(t, false, undefined, expandObjects, exportNames))
      .join(' & ');
  }

  if (type instanceof tae.ObjectNode) {
    if (type.typeName && !expandObjects) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    if (isObjectEmpty(type.properties)) {
      return '{}';
    }

    return `{ ${type.properties
      .map(
        (m) =>
          `${m.name}${m.optional ? '?' : ''}: ${formatType(m.type, m.optional, undefined, expandObjects, exportNames)}`,
      )
      .join(', ')} }`;
  }

  if (type instanceof tae.LiteralNode) {
    return normalizeQuotes(type.value as string);
  }

  if (type instanceof tae.ArrayNode) {
    const formattedMemberType = formatType(
      type.elementType,
      false,
      undefined,
      expandObjects,
      exportNames,
    );

    if (formattedMemberType.includes(' ')) {
      return `(${formattedMemberType})[]`;
    }

    return `${formattedMemberType}[]`;
  }

  if (type instanceof tae.FunctionNode) {
    // If object expansion is requested, we want to fully expand the function signature instead
    // of returning the aliased type name (e.g., OffsetFunction).
    if (!expandObjects && type.typeName && !type.typeName.name?.startsWith('ComponentRenderFn')) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    const functionSignature = type.callSignatures
      .map((s) => {
        const params = s.parameters
          .map(
            (p) => `${p.name}: ${formatType(p.type, false, undefined, expandObjects, exportNames)}`,
          )
          .join(', ');
        const returnType = formatType(
          s.returnValueType,
          false,
          undefined,
          expandObjects,
          exportNames,
        );
        return `(${params}) => ${returnType}`;
      })
      .join(' | ');
    return `(${functionSignature})`;
  }

  if (type instanceof tae.TupleNode) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    return `[${type.types.map((member: tae.AnyType) => formatType(member, false, undefined, expandObjects, exportNames)).join(', ')}]`;
  }

  if (type instanceof tae.TypeParameterNode) {
    return type.constraint !== undefined
      ? formatType(type.constraint, removeUndefined, undefined, expandObjects, exportNames)
      : type.name;
  }

  return 'unknown';
}

export async function prettyFormatType(...args: Parameters<typeof formatType>) {
  return prettyFormat(
    formatType(...args),
    args[0].kind === 'object' ? args[0].typeName?.name : undefined,
  );
}

function getFullyQualifiedName(typeName: tae.TypeName, exportNames: string[]): string {
  const nameWithTypeArgs = createNameWithTypeArguments(typeName, exportNames);

  if (!typeName.namespaces || typeName.namespaces.length === 0) {
    return nameWithTypeArgs;
  }

  // Our components are defined in the source as [ComponentName][Part], but exported as [ComponentName].[Part].
  // The following code adjusts the namespaces to match the exported names.
  const joinedNamespaces = typeName.namespaces.map((namespace) => {
    const exportNameInNamespace = exportNames.find((exportName) =>
      new RegExp(`^${exportName}[A-Z]`).test(namespace),
    );

    if (exportNameInNamespace) {
      const dotPosition = exportNameInNamespace.length;
      return `${namespace.substring(0, dotPosition)}.${namespace.substring(dotPosition)}`;
    }

    return namespace;
  });

  return `${joinedNamespaces}.${nameWithTypeArgs}`;
}

function createNameWithTypeArguments(typeName: tae.TypeName, exportNames: string[] = []) {
  if (
    typeName.typeArguments &&
    typeName.typeArguments.length > 0 &&
    typeName.typeArguments.some((ta) => ta.equalToDefault === false)
  ) {
    return `${typeName.name}<${typeName.typeArguments.map((ta) => formatType(ta.type, false, undefined, false, exportNames)).join(', ')}>`;
  }

  return typeName.name;
}

/**
 * Looks for 'any', 'null' and 'undefined' types and moves them to the end of the array of types.
 */
function orderMembers(members: readonly tae.AnyType[]): readonly tae.AnyType[] {
  let orderedMembers = pushToEnd(members, 'any');
  orderedMembers = pushToEnd(orderedMembers, 'null');
  orderedMembers = pushToEnd(orderedMembers, 'undefined');
  return orderedMembers;
}

function pushToEnd(members: readonly tae.AnyType[], name: string): readonly tae.AnyType[] {
  const index = members.findIndex((member: tae.AnyType) => {
    return member instanceof tae.IntrinsicNode && member.intrinsic === name;
  });

  if (index !== -1) {
    const member = members[index];
    return [...members.slice(0, index), ...members.slice(index + 1), member];
  }

  return members;
}

function isObjectEmpty(object: Record<any, any>) {
  // eslint-disable-next-line
  for (const _ in object) {
    return false;
  }
  return true;
}

function normalizeQuotes(str: string) {
  if (str.startsWith('"') && str.endsWith('"')) {
    return str
      .replaceAll("'", "\\'")
      .replaceAll('\\"', '"')
      .replace(/^"(.*)"$/, "'$1'");
  }

  return str;
}
