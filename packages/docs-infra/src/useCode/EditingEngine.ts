/**
 * The edit-time source-manipulation chunk. Holds the work an edit needs once
 * the text has already changed — `analyzeSource`, `shiftComments`, and
 * `toControlledCode`. Importing this module is heavy, so it is only ever
 * reached through the `editingEngineLoader` accessor (eager `CodeProvider`
 * bundles it; `CodeProviderLazy` code-splits it) or the dynamic import in
 * `./editingEngineCache`, keeping it out of a read-only block's bundle.
 *
 * The editing *surface* lives in a separate chunk (`./CodeEditor`, reached via
 * `codeEditorLoader`) so a block that only commits programmatic edits never
 * pulls the editor in.
 */

export { analyzeSource, shiftComments, toControlledCode } from './SourceEditingEngine';
