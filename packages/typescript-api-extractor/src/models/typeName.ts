import type { AnyType } from './node';

export class TypeName {
  declare public readonly name: string;
  declare public readonly namespaces: readonly string[] | undefined;
  declare public readonly typeArguments: readonly TypeArgument[] | undefined;
  /**
   * The names under which the parsed module exports the named type, in export
   * order, dotted for namespace members (`['Field.Root.State', 'FieldRootState']`).
   * Matched by symbol, so a re-export under another name (`export type { State
   * as ToggleState }`) lists `ToggleState`, and an unexported type that shares
   * an exported type's name lists nothing.
   */
  declare public readonly exportedAs?: readonly string[];

  constructor(
    name: string,
    namespaces: readonly string[] | undefined = undefined,
    typeArguments: readonly TypeArgument[] | undefined = undefined,
    exportedAs: readonly string[] | undefined = undefined,
  ) {
    this.name = name;
    this.namespaces = namespaces;
    this.typeArguments = typeArguments;
    this.exportedAs = exportedAs;
  }

  toString(): string {
    if (!this.namespaces || this.namespaces.length === 0) {
      return formatNameWithTypeArguments(this.name, this.typeArguments);
    }

    return `${this.namespaces.join('.')}.${formatNameWithTypeArguments(this.name, this.typeArguments)}`;
  }
}

export interface TypeArgument {
  type: AnyType;
  equalToDefault: boolean;
}

function formatNameWithTypeArguments(
  name: string,
  typeArguments: readonly TypeArgument[] | undefined,
): string {
  if (!typeArguments || typeArguments.length === 0) {
    return name;
  }

  const args = typeArguments.map((arg) => arg.type.toString()).join(', ');
  return `${name}<${args}>`;
}
