import type { DeclarationSpaces, ExportNode } from './export';

/**
 * One export of a module reached through a namespace re-export, whether or not
 * it produced an `ExportNode`. A namespace declared in the module or re-exported
 * from it has no `ExportNode` of its own but is listed here.
 */
export interface NamespaceReexportMember extends DeclarationSpaces {
  /** The name the module exports it under, e.g. `pressed` or `default` */
  name: string;
}

/**
 * A namespace re-export (`export * as Name from './module'`), which has no
 * `ExportNode` of its own: the module's exports are flattened into exports named
 * `Name.member`.
 */
export interface NamespaceReexport {
  /**
   * The public path of the namespace, e.g. `ButtonDataAttributes`, or
   * `Toolbar.ButtonDataAttributes` for one re-exported by another.
   */
  name: string;
  /**
   * Whether the namespace is a runtime module namespace object. It is not when
   * reached only through type-only sites, such as `export type * as Name`.
   */
  isValue: boolean;
  /**
   * Every export of the module, with the declaration spaces it is reached with
   * through this namespace. Exports hidden by type-only sites are left out.
   */
  members: NamespaceReexportMember[];
}

export class ModuleNode {
  constructor(
    public name: string,
    public exports: ExportNode[],
    public imports: string[] | undefined = undefined,
    /** The namespace re-exports reached from the module, outer ones first. */
    public namespaceReexports: NamespaceReexport[] | undefined = undefined,
  ) {}
}
