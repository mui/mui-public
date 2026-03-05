import { uniq } from 'es-toolkit';
import type * as tae from 'typescript-api-extractor';
import {
  isExternalType,
  isIntrinsicType,
  isUnionType,
  isIntersectionType,
  isObjectType,
  isArrayType,
  isFunctionType,
  isLiteralType,
  isTupleType,
  isTypeParameterType,
  isInternalTypeName,
} from './typeGuards';
import {
  isOwnTypeName,
  maybeCollectExternalUnion,
  maybeCollectExternalFunction,
  maybeCollectExternalReference,
  type ExternalTypesCollector,
} from './externalTypes';
import { prettyFormat } from './format';

export interface FormatTypeOptions {
  removeUndefined?: boolean;
  jsdocTags?: tae.DocumentationTag[];
  expandObjects?: boolean;
  exportNames: string[];
  typeNameMap: Record<string, string>;
  externalTypesCollector?: ExternalTypesCollector;
  selfName?: string;
  withPropertyComments?: boolean;
  preserveTypeParameters?: boolean;
}

export function formatType(type: tae.AnyType, options: FormatTypeOptions): string {
  const {
    removeUndefined = false,
    jsdocTags,
    expandObjects = false,
    exportNames,
    typeNameMap,
    externalTypesCollector,
    selfName,
    withPropertyComments,
    preserveTypeParameters,
  } = options;

  /**
   * Checks if a qualified type name matches the selfName (type being defined).
   * Strips type arguments before comparing to handle generic instances.
   * e.g., "Tabs.Root.ChangeEventDetails<'none', ...>" should match "Tabs.Root.ChangeEventDetails"
   */
  function matchesSelfName(qualifiedName: string, simpleName: string | undefined): boolean {
    if (!selfName) {
      return false;
    }
    // Strip type arguments from the qualified name for comparison
    const baseQualifiedName = qualifiedName.replace(/<.*>$/, '');
    return (
      simpleName === selfName ||
      baseQualifiedName === selfName ||
      // Also check dots-removed form to handle cases where selfName is the
      // flattened display name (e.g., "FormState") and qualifiedName is dotted
      // (e.g., "Form.State")
      baseQualifiedName.replace(/\./g, '') === selfName
    );
  }

  const typeTag = jsdocTags?.find?.((tag) => tag.name === 'type');
  const typeValue = typeTag?.value;

  if (typeValue) {
    return typeValue;
  }

  if (isExternalType(type)) {
    if (/^ReactElement(<.*>)?/.test(type.typeName.name || '')) {
      return 'ReactElement';
    }

    if (type.typeName.namespaces?.length === 1 && type.typeName.namespaces[0] === 'React') {
      return createNameWithTypeArguments(
        type.typeName,
        exportNames,
        typeNameMap,
        externalTypesCollector,
        preserveTypeParameters,
      );
    }

    const qualifiedName = getFullyQualifiedName(
      type.typeName,
      exportNames,
      typeNameMap,
      preserveTypeParameters,
    );

    if (externalTypesCollector) {
      // Only collect as external if the qualified name wasn't rewritten to an own type.
      if (
        qualifiedName === type.typeName.name ||
        !isOwnTypeName(qualifiedName, externalTypesCollector)
      ) {
        maybeCollectExternalReference(type, externalTypesCollector);
      }
    }

    return qualifiedName;
  }

  if (isIntrinsicType(type)) {
    return type.typeName
      ? getFullyQualifiedName(type.typeName, exportNames, typeNameMap, preserveTypeParameters)
      : type.intrinsic;
  }

  if (isUnionType(type)) {
    // For union types with a type alias name, always prefer showing the alias name
    // (e.g., 'StoreAtMode' instead of expanding to "'canonical' | 'import' | 'flat'")
    // The expandObjects flag is primarily for object types where showing the structure is valuable
    // But skip if the type name matches selfName to avoid circular references like `type Foo = Foo`
    if (type.typeName) {
      const qualifiedName = getFullyQualifiedName(
        type.typeName,
        exportNames,
        typeNameMap,
        preserveTypeParameters,
      );
      // Check both the simple name AND the fully qualified name against selfName
      // selfName can be either format depending on context
      // Also strip type arguments to catch cases like `type Foo = Foo<Args>`
      if (!matchesSelfName(qualifiedName, type.typeName.name)) {
        if (externalTypesCollector) {
          // Only collect as external if the qualified name wasn't rewritten to an own type.
          // e.g., BaseOrientation → Tabs.Root.Orientation means it's an own type alias,
          // not an external type that should appear in the External Types section.
          if (
            qualifiedName === type.typeName.name ||
            !isOwnTypeName(qualifiedName, externalTypesCollector)
          ) {
            maybeCollectExternalUnion(type, externalTypesCollector);
          }
        }
        return qualifiedName;
      }
    }

    let memberTypes = type.types;

    if (removeUndefined) {
      memberTypes = memberTypes.filter((t) => !(isIntrinsicType(t) && t.intrinsic === 'undefined'));
    }

    // Deduplicates types in unions.
    // Plain unions are handled by TypeScript API Extractor, but we also display unions in type parameters constraints,
    // so we need to merge those here.
    const flattenedMemberTypes = memberTypes.flatMap((t) => {
      if (isUnionType(t)) {
        return t.typeName ? t : t.types;
      }

      if (isTypeParameterType(t) && isUnionType(t.constraint)) {
        return t.constraint.types;
      }

      return t;
    });

    const formattedMemeberTypes = uniq(
      orderMembers(flattenedMemberTypes).map((t) =>
        // Use expandObjects=false for nested types to prevent deep expansion
        formatType(t, {
          removeUndefined,
          exportNames,
          typeNameMap,
          externalTypesCollector,
          preserveTypeParameters,
        }),
      ),
    );

    return formattedMemeberTypes.join(' | ');
  }

  if (isIntersectionType(type)) {
    // For intersection types with a type alias name, always prefer showing the alias name
    // The expandObjects flag is primarily for object types where showing the structure is valuable
    // But skip if the type name matches selfName to avoid circular references like `type Foo = Foo`
    if (type.typeName) {
      const qualifiedName = getFullyQualifiedName(
        type.typeName,
        exportNames,
        typeNameMap,
        preserveTypeParameters,
      );
      // Check both the simple name AND the fully qualified name against selfName
      // selfName can be either format depending on context
      // Also strip type arguments to catch cases like `type Foo = Foo<Args>`
      if (!matchesSelfName(qualifiedName, type.typeName.name)) {
        return qualifiedName;
      }
    }

    // Check if all members are object types - if so, merge them into a single object
    const allAreObjects = type.types.every((t) => isObjectType(t));
    if (allAreObjects) {
      // Merge all properties from all object types
      const mergedProperties = type.types.flatMap((t) =>
        isObjectType(t) ? (t.properties ?? []) : [],
      );

      if (mergedProperties.length > 0) {
        const parts = mergedProperties.map((m) => {
          const propertyName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(m.name) ? m.name : `'${m.name}'`;
          const typeStr = formatType(m.type, {
            removeUndefined: m.optional,
            exportNames,
            typeNameMap,
            externalTypesCollector,
            withPropertyComments,
            preserveTypeParameters,
          });
          const propLine = `${propertyName}${m.optional ? '?' : ''}: ${typeStr}`;

          if (withPropertyComments && m.documentation) {
            const comment = formatPropertyComment(m.documentation);
            if (comment) {
              return `${comment}\n${propLine}`;
            }
          }

          return propLine;
        });
        const hasComments = withPropertyComments && parts.some((p) => p.includes('/**'));
        const separator = hasComments ? ';\n' : '; ';
        return `{ ${parts.join(separator)} }`;
      }
    }

    const formattedMembers = orderMembers(type.types)
      // Use expandObjects=false for nested types to prevent deep expansion
      .map((t) =>
        formatType(t, {
          exportNames,
          typeNameMap,
          externalTypesCollector,
          preserveTypeParameters,
        }),
      )
      // Filter out empty objects (e.g., `& {}` from generic defaults)
      .filter((formatted) => formatted !== '{}' && formatted !== '{ }');

    // If all members were filtered out, return empty object
    if (formattedMembers.length === 0) {
      return '{}';
    }

    // If only one member remains, return it without intersection
    if (formattedMembers.length === 1) {
      return formattedMembers[0];
    }

    return formattedMembers.join(' & ');
  }

  if (isObjectType(type)) {
    // Check if the object has an index signature
    const indexSignature = (
      type as tae.ObjectNode & {
        indexSignature?: { keyName?: string; keyType: string; valueType: tae.AnyType };
      }
    ).indexSignature;

    // Check if the type name is a TypeScript internal symbol name (e.g., __object, __type)
    // These are anonymous types and should not be displayed as-is
    const hasValidTypeName = type.typeName && !isInternalTypeName(type.typeName.name);

    // If the type has a name and we're not expanding objects, return the type name
    // BUT if the type name matches selfName, we need to expand to avoid circular references
    // like `type ToastManager = ToastManager`
    if (hasValidTypeName && !expandObjects) {
      const qualifiedName = getFullyQualifiedName(
        type.typeName!,
        exportNames,
        typeNameMap,
        preserveTypeParameters,
      );
      if (!matchesSelfName(qualifiedName, type.typeName!.name)) {
        return qualifiedName;
      }
      // Fall through to expand the type since it's a self-reference
    }

    // If the object is empty (no properties or index signature), use the type name if available
    // This ensures types like `DialogHandle<Payload>` are shown instead of `{}`
    if (isObjectEmpty(type.properties) && !indexSignature) {
      if (hasValidTypeName) {
        const qualifiedName = getFullyQualifiedName(
          type.typeName!,
          exportNames,
          typeNameMap,
          preserveTypeParameters,
        );
        if (!matchesSelfName(qualifiedName, type.typeName!.name)) {
          return qualifiedName;
        }
      }
      return '{}';
    }

    const parts: string[] = [];

    // Add index signature if present
    // Use expandObjects=false for value types to prevent deep expansion (one level only)
    if (indexSignature) {
      const valueTypeStr = formatType(indexSignature.valueType, {
        exportNames,
        typeNameMap,
        externalTypesCollector,
        preserveTypeParameters,
      });
      // Use the original key name if available, otherwise fall back to 'key'
      const keyName = indexSignature.keyName || 'key';
      parts.push(`[${keyName}: ${indexSignature.keyType}]: ${valueTypeStr}`);
    }

    // Add regular properties
    // Use expandObjects=false for property types to prevent deep expansion (one level only)
    parts.push(
      ...type.properties.map((m) => {
        // Property names with hyphens or other special characters need quotes
        const propertyName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(m.name) ? m.name : `'${m.name}'`;
        const typeStr = formatType(m.type, {
          removeUndefined: m.optional,
          exportNames,
          typeNameMap,
          externalTypesCollector,
          withPropertyComments,
          preserveTypeParameters,
        });
        const propLine = `${propertyName}${m.optional ? '?' : ''}: ${typeStr}`;

        if (withPropertyComments && m.documentation) {
          const comment = formatPropertyComment(m.documentation);
          if (comment) {
            return `${comment}\n${propLine}`;
          }
        }

        return propLine;
      }),
    );

    // Use newline separators when comments are present so Prettier
    // places each comment on its own line above its property
    const hasComments = withPropertyComments && parts.some((p) => p.includes('/**'));
    const separator = hasComments ? ';\n' : '; ';
    return `{ ${parts.join(separator)} }`;
  }

  if (isLiteralType(type)) {
    return normalizeQuotes(String(type.value));
  }

  if (isArrayType(type)) {
    // Use expandObjects=false for element types to prevent deep expansion (one level only)
    const formattedMemberType = formatType(type.elementType, {
      exportNames,
      typeNameMap,
      externalTypesCollector,
      preserveTypeParameters,
    });

    if (formattedMemberType.includes(' ')) {
      return `(${formattedMemberType})[]`;
    }

    return `${formattedMemberType}[]`;
  }

  if (isFunctionType(type)) {
    // If a function type has a typeName, it's a named type alias (like OffsetFunction).
    // Show the type name instead of expanding the full signature.
    // Anonymous functions (like `() => void` inline) don't have typeNames.
    //
    // Exception: ComponentRenderFn types are internal implementation details and should be expanded.
    // Exception: When expandObjects is true (for detailed type view), always expand.
    const hasNamedTypeAlias =
      type.typeName?.name && !type.typeName.name.startsWith('ComponentRenderFn');

    if (hasNamedTypeAlias && !expandObjects) {
      const qualifiedName = getFullyQualifiedName(
        type.typeName!,
        exportNames,
        typeNameMap,
        preserveTypeParameters,
      );
      if (externalTypesCollector) {
        // Only collect as external if the qualified name wasn't rewritten to an own type.
        if (
          qualifiedName === type.typeName!.name ||
          !isOwnTypeName(qualifiedName, externalTypesCollector)
        ) {
          maybeCollectExternalFunction(type, externalTypesCollector);
        }
      }
      return qualifiedName;
    }

    const signatures = type.callSignatures.map((s) => {
      // Format method-level type parameters (e.g., `<T extends Data = Data>` on individual methods)
      const genericPrefix = s.typeParameters?.length
        ? `<${s.typeParameters
            .map((tp) => {
              let result = tp.name;
              if (tp.constraint !== undefined) {
                result += ` extends ${formatType(tp.constraint, { exportNames, typeNameMap, externalTypesCollector, preserveTypeParameters })}`;
              }
              if (tp.defaultValue !== undefined) {
                result += ` = ${formatType(tp.defaultValue, { exportNames, typeNameMap, externalTypesCollector, preserveTypeParameters })}`;
              }
              return result;
            })
            .join(', ')}>`
        : '';

      // Preserve method-level type parameter names within this signature's body
      const localPreserve = preserveTypeParameters || (s.typeParameters?.length ?? 0) > 0;

      // Use expandObjects=false for nested types to prevent deep expansion (one level only)
      const params = s.parameters
        .map((p, index, allParams) => {
          let paramType = formatType(p.type, {
            exportNames,
            typeNameMap,
            externalTypesCollector,
            preserveTypeParameters: localPreserve,
          });

          // Check if the type includes undefined
          const hasUndefined =
            paramType.includes('| undefined') || paramType.includes('undefined |');

          // Use ?: syntax for optional parameters only if all following parameters are also optional
          // This ensures we maintain valid TypeScript syntax (optional params must come last)
          if (p.optional || hasUndefined) {
            const remainingParams = allParams.slice(index + 1);
            const allRemainingAreOptional = remainingParams.every((remaining) => {
              // If the parameter is explicitly marked as optional, we don't need to check the type
              if (remaining.optional) {
                return true;
              }
              // Only check the type if the parameter is not explicitly optional
              // Check if it's a union with undefined without formatting the entire type
              if (isUnionType(remaining.type)) {
                return remaining.type.types.some(
                  (t) => isIntrinsicType(t) && t.intrinsic === 'undefined',
                );
              }
              return false;
            });

            if (allRemainingAreOptional) {
              // Remove | undefined from the type since we're using ?:
              paramType = paramType
                .replace(/\s*\|\s*undefined\s*$/, '')
                .replace(/^\s*undefined\s*\|\s*/, '')
                .trim();
              return `${p.name}?: ${paramType}`;
            }
          }

          return `${p.name}: ${paramType}`;
        })
        .join(', ');
      // Use expandObjects=false for return type to prevent deep expansion (one level only)
      const returnType = formatType(s.returnValueType, {
        exportNames,
        typeNameMap,
        externalTypesCollector,
        preserveTypeParameters: localPreserve,
      });
      return `${genericPrefix}(${params}) => ${returnType}`;
    });

    // When there are multiple signatures (overloads), each function type must be
    // parenthesized before joining with | to avoid ambiguous parsing
    // e.g., ((a: string) => void) | ((b: number) => void)
    const functionSignature =
      signatures.length > 1
        ? signatures.map((sig) => `(${sig})`).join(' | ')
        : signatures.join(' | ');
    return `(${functionSignature})`;
  }

  if (isTupleType(type)) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames, typeNameMap, preserveTypeParameters);
    }

    // Use expandObjects=false for tuple members to prevent deep expansion (one level only)
    return `[${type.types.map((member: tae.AnyType) => formatType(member, { exportNames, typeNameMap, externalTypesCollector, preserveTypeParameters })).join(', ')}]`;
  }

  if (isTypeParameterType(type)) {
    // When preserveTypeParameters is true, return the parameter name (e.g., "T")
    // instead of expanding to its constraint. This is used by formatRaw where the
    // constraint is shown in the type parameter declaration (e.g., `<T extends string>`)
    // via formatTypeParameterDeclaration, so expanding here would lose the generic
    // identity and produce misleading output.
    // Exception: if the type parameter name matches selfName, expanding is required
    // to avoid circular references like `type FormValues = FormValues;`
    if (preserveTypeParameters && type.name !== selfName) {
      return type.name;
    }
    return type.constraint !== undefined
      ? formatType(type.constraint, {
          expandObjects,
          exportNames,
          typeNameMap,
          externalTypesCollector,
        })
      : type.name;
  }

  return 'unknown';
}

/**
 * Formats a TypeScript type into a prettified string representation.
 *
 * This is a convenience wrapper around `formatType()` that applies Prettier formatting
 * to the resulting type string. It delegates to `formatType()` for the core type
 * processing, then runs the output through `prettyFormat()` for consistent styling.
 */
export async function prettyFormatType(type: tae.AnyType, options: FormatTypeOptions) {
  return prettyFormat(
    formatType(type, options),
    type.kind === 'object' ? type.typeName?.name : undefined,
  );
}

export function getFullyQualifiedName(
  typeName: tae.TypeName,
  exportNames: string[],
  typeNameMap: Record<string, string>,
  preserveTypeParameters?: boolean,
): string {
  const nameWithTypeArgs = createNameWithTypeArguments(
    typeName,
    exportNames,
    typeNameMap,
    undefined,
    preserveTypeParameters,
  ); // Note: externalTypesCollector not threaded here since getFullyQualifiedName is name-only lookup

  // Construct the flat name (what parseExports would have created)
  const flatName =
    typeName.namespaces && typeName.namespaces.length > 0
      ? typeName.namespaces.join('') + typeName.name
      : typeName.name;

  // Check if this type is in our map (exact match)
  if (typeNameMap[flatName]) {
    // This is one of our component types - use the mapped dotted name
    const typeArgsStart = nameWithTypeArgs.indexOf('<');

    if (typeArgsStart !== -1) {
      // Preserve type arguments
      return typeNameMap[flatName] + nameWithTypeArgs.slice(typeArgsStart);
    }
    return typeNameMap[flatName];
  }

  // Check if flatName matches a dotted export with dots removed
  // e.g., ComponentPartState -> Component.Part.State (if that export exists)
  for (const dottedName of Object.values(typeNameMap)) {
    if (dottedName.replace(/\./g, '') === flatName) {
      const typeArgsStart = nameWithTypeArgs.indexOf('<');
      if (typeArgsStart !== -1) {
        return dottedName + nameWithTypeArgs.slice(typeArgsStart);
      }
      return dottedName;
    }
  }

  // Check if we have a namespaced reference where the namespace itself needs transformation
  // E.g., MenuRoot.Actions.Handler where MenuRoot → Menu.Root → Menu.Root.Actions.Handler
  // This check comes BEFORE flat prefix matching to preserve namespace structure
  if (typeName.namespaces && typeName.namespaces.length > 0) {
    // Check if any namespace part is in the typeNameMap
    const transformedNamespaces = typeName.namespaces.map((ns) => typeNameMap[ns] || ns);
    const hasTransformation = transformedNamespaces.some((ns, i) => ns !== typeName.namespaces![i]);

    if (hasTransformation) {
      // Build the transformed name: TransformedNamespace.Member
      const transformedName = [...transformedNamespaces, typeName.name].join('.');
      const typeArgsStart = nameWithTypeArgs.indexOf('<');

      if (typeArgsStart !== -1) {
        // Preserve type arguments
        return transformedName + nameWithTypeArgs.slice(typeArgsStart);
      }
      return transformedName;
    }
  }

  // Check if flatName starts with a known component prefix
  // e.g., "ComponentPartState" starts with "ComponentPart" -> "Component.Part", so becomes "Component.Part.State"
  // This handles types that don't have namespace structure (already flattened)
  const sortedEntries = Object.entries(typeNameMap).sort((a, b) => b[0].length - a[0].length);
  for (const [flat, dotted] of sortedEntries) {
    if (flatName.startsWith(flat) && flatName.length > flat.length) {
      const suffix = flatName.slice(flat.length);
      const dottedName = `${dotted}.${suffix}`;
      const typeArgsStart = nameWithTypeArgs.indexOf('<');
      if (typeArgsStart !== -1) {
        return dottedName + nameWithTypeArgs.slice(typeArgsStart);
      }
      return dottedName;
    }
  }

  // No transformation needed - return as-is preserving namespace structure
  // For external types like React.ComponentType, preserve the dotted format
  if (typeName.namespaces && typeName.namespaces.length > 0) {
    const dottedName = [...typeName.namespaces, typeName.name].join('.');
    const typeArgsStart = nameWithTypeArgs.indexOf('<');
    if (typeArgsStart !== -1) {
      return dottedName + nameWithTypeArgs.slice(typeArgsStart);
    }
    return dottedName;
  }

  // Not in the map and no namespaces - it's an external type (React, HTMLElement, etc.)
  return nameWithTypeArgs;
}

function createNameWithTypeArguments(
  typeName: tae.TypeName,
  exportNames: string[],
  typeNameMap: Record<string, string>,
  externalTypesCollector?: ExternalTypesCollector,
  preserveTypeParameters?: boolean,
) {
  const prefix =
    typeName.namespaces && typeName.namespaces.length > 0
      ? `${typeName.namespaces.join('.')}.`
      : '';

  if (
    typeName.typeArguments &&
    typeName.typeArguments.length > 0 &&
    typeName.typeArguments.some((ta) => ta.equalToDefault === false)
  ) {
    return `${prefix}${typeName.name}<${typeName.typeArguments.map((ta) => formatType(ta.type, { exportNames, typeNameMap, externalTypesCollector, preserveTypeParameters })).join(', ')}>`;
  }

  return `${prefix}${typeName.name}`;
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
    return isIntrinsicType(member) && member.intrinsic === name;
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

/**
 * Formats a JSDoc comment block from property documentation.
 * Returns undefined if no meaningful content to document.
 */
function formatPropertyComment(documentation: tae.Documentation): string | undefined {
  const lines: string[] = [];

  if (documentation.description) {
    lines.push(...documentation.description.split('\n'));
  }

  if (documentation.defaultValue !== undefined) {
    lines.push(`@default ${String(documentation.defaultValue)}`);
  }

  // Include all tags preserved by tae (it already filters out @default,
  // @private, @internal, @public, and @param during parsing).
  // Split multi-line tag values so each line gets the ` * ` JSDoc prefix.
  for (const tag of documentation.tags ?? []) {
    if (tag.value) {
      const tagLines = tag.value.split('\n');
      if (tagLines.length > 1) {
        // Multi-line values go on new lines after the tag name
        lines.push(`@${tag.name}`);
        for (const tagLine of tagLines) {
          lines.push(tagLine);
        }
      } else {
        lines.push(`@${tag.name} ${tagLines[0]}`);
      }
    } else {
      lines.push(`@${tag.name}`);
    }
  }

  if (lines.length === 0) {
    return undefined;
  }

  if (lines.length === 1) {
    return `/** ${lines[0]} */`;
  }

  return `/**\n${lines.map((line) => ` * ${line}`).join('\n')}\n */`;
}
