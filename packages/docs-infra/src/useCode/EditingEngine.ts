/**
 * The single live-editing engine chunk. Co-locates the two pieces an editable
 * block always needs together — the contentEditable runtime + keyboard/paste/
 * caret handlers (`createEditableEngine`, which pulls `react-dom` and the DOM
 * utilities) and the edit-time source manipulation (`analyzeSource`,
 * `shiftComments`, `toControlledCode`) — so the bundler emits ONE chunk for both
 * instead of two. Importing this module is heavy; it is only ever reached
 * through the `editingEngineLoader` accessor (eager `CodeProvider` bundles it;
 * `CodeProviderLazy` code-splits it) or the dynamic import in
 * `./editingEngineCache`, so a read-only block never pulls it in.
 */

export { createEditableEngine } from './EditableEngine';
export { analyzeSource, shiftComments, toControlledCode } from './SourceEditingEngine';
