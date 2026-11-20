import type { AnyType } from './node';

export class TypeName {
  declare public readonly name: string;
  declare public readonly namespaces: readonly string[] | undefined;
  declare public readonly typeArguments: readonly TypeArgument[] | undefined;
  /**
   * The id of the declaration the name refers to, the same id an export of that
   * declaration carries (`ExportNode.declarationId`), so a reference can be matched
   * to the exports of its type whatever name it is written with. Only types the
   * project declares have one: names of types from `node_modules` or the default
   * library, and names that do not come from a declaration, such as type
   * parameters, have none.
   */
  declare public readonly declarationId?: string;

  constructor(
    name: string,
    namespaces: readonly string[] | undefined = undefined,
    typeArguments: readonly TypeArgument[] | undefined = undefined,
    declarationId: string | undefined = undefined,
  ) {
    this.name = name;
    this.namespaces = namespaces;
    this.typeArguments = typeArguments;
    if (declarationId !== undefined) {
      this.declarationId = declarationId;
    }
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
