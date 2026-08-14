/**
 * The caret position reported alongside an edit. Travels with every `setSource`
 * call so the host can shift derived state (comment and highlight maps) onto the
 * edited source without re-deriving it from scratch.
 *
 * The textarea editor sets `position`, `extent`, `content`, and `line`. The
 * remaining fields describe cases only a richer edit source can distinguish, and
 * `SourceEditingEngine` treats each as optional.
 */
export interface Position {
  position: number;
  extent: number;
  content: string;
  line: number;
  /**
   * Set only when this position originates from an undo/redo navigation, naming
   * the direction. On `'undo'` the caret is the PRE-edit position (it did not
   * move as forward typing would), so derived state (e.g. the comment/highlight
   * map) must reverse the edit rather than assume a post-edit caret. Absent for
   * a fresh edit.
   */
  history?: 'undo' | 'redo';
  /**
   * On an `'undo'`, the 0-indexed line the reversed edit was anchored at — its
   * POST-edit caret line, which can differ from this (destination) caret when
   * the edit ran over a selection that didn't start at the caret (e.g. Select
   * All). Lets derived state reverse the edit at the exact line the forward
   * edit pivoted on instead of guessing from the destination caret.
   */
  historyPivotLine?: number;
  /**
   * Set when the edit removed whole lines starting at the very beginning of a
   * line (a selection delete whose start was at column 0). The post-edit caret
   * then sits on the line that shifted up from BELOW the deletion, so the edit's
   * anchor is one line higher than the caret implies. Derived state (comment
   * map) must drop its anchor by one or markers on the deleted first line are
   * stranded. Rides through undo as well so the reversal anchors identically.
   */
  deletedFromLineStart?: boolean;
  /**
   * Set when the tracked selection is a BACKWARD range — its focus (the moving
   * end) sits at the range START, above/before the anchor. `position`/`extent`
   * only describe the range's extent, not which end is the focus, so a backward
   * Shift+Arrow selection that survives a host re-render would otherwise be
   * rebuilt as a forward range (focus flipped to the bottom), making the next
   * Shift+Arrow extend from the wrong end. Absent for a collapsed caret or a
   * forward selection.
   */
  backward?: boolean;
}
