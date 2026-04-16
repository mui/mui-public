/**
 * Metadata for an emphasized line.
 */
export interface EmphasisMeta {
  /** Optional description for this emphasis */
  description?: string;
  /** Position: 'single' for single-line, 'start'/'end' for multiline range bounds, undefined for middle */
  position?: 'single' | 'start' | 'end';
  /** Whether this is a strong emphasis (description ended with !) */
  strong?: boolean;
  /** For text highlighting: the specific texts to highlight within the line */
  highlightTexts?: string[];
  /** Whether this line's region is the focused region (for padding) */
  focus?: boolean;
  /** Whether the line itself should receive data-hl. True for highlight directives and false for focus-only directives. */
  lineHighlight: boolean;
  /** How many containing highlight ranges wrap this line (used for mark data-hl propagation) */
  containingRangeDepth?: number;
  /** Optional per-directive padding override for this region */
  paddingFrameMaxSize?: number;
  /** Optional per-directive focus max size override for this region */
  focusFramesMaxSize?: number;
  /**
   * True when the overrides were propagated from a multiline range
   * rather than set by an explicit per-line directive.
   * Explicit overrides take precedence over propagated ones in regions.
   */
  propagatedOverride?: boolean;
}

/**
 * A range of lines that forms a frame in the output.
 */
export interface FrameRange {
  /** First line number (1-based, inclusive) */
  startLine: number;
  /** Last line number (1-based, inclusive) */
  endLine: number;
  /** The type of frame */
  type:
    | 'normal'
    | 'padding-top'
    | 'highlighted'
    | 'highlighted-unfocused'
    | 'focus'
    | 'focus-unfocused'
    | 'padding-bottom'
    | 'comment';
  /** Index of the highlighted region this frame belongs to. Present on region-type frames. */
  regionIndex?: number;
  /**
   * Present on frames created by splitting an oversized region via `focusFramesMaxSize`.
   * - `'visible'` — the focused window kept visible when collapsed.
   * - `'hidden'`  — the overflow portion hidden when collapsed.
   */
  truncated?: 'visible' | 'hidden';
}

/**
 * A contiguous region of highlighted lines.
 */
interface HighlightRegion {
  /** First highlighted line number (1-based) */
  startLine: number;
  /** Last highlighted line number (1-based) */
  endLine: number;
  /** Index of this region in the sorted list */
  index: number;
  /** Whether this region is the focused region */
  focused: boolean;
  /** Whether any line in this region has line-level highlighting (data-hl) */
  hasLineHighlight: boolean;
  /** Per-directive padding override for this region, if specified */
  paddingFrameMaxSize?: number;
  /** Per-directive focus max size override for this region, if specified */
  focusFramesMaxSize?: number;
}

/**
 * Options for the enhance code emphasis factory.
 */
export interface EnhanceCodeEmphasisOptions {
  /**
   * Maximum number of padding lines above and below the focused highlight region.
   * Padding frames provide surrounding context for the highlighted code.
   * Set to 0 or omit to disable padding frames.
   */
  paddingFrameMaxSize?: number;
  /**
   * Maximum total number of lines in the focus area (padding-top + focused region + padding-bottom).
   * Defaults to `12` when not explicitly configured.
   * @default 12
   * When the region fits within this limit, padding sizes are reduced so the total focus area
   * fits. The remainder after subtracting the region size is split: floor(remainder/2) for
   * padding-top and ceil(remainder/2) for padding-bottom.
   * When the region exceeds this limit, a focused window is taken from the start of the
   * region, and the remaining overflow lines are marked as unfocused.
   */
  focusFramesMaxSize?: number;
  /**
   * When `true`, throws an error if a `@highlight-text` match has to be
   * fragmented across element boundaries (producing `data-hl-part` spans).
   * Wrapping multiple complete elements in a single `data-hl` span is still
   * allowed — only boundary-straddling matches are rejected.
   */
  strictHighlightText?: boolean;
}

/** Default max number of lines kept in focus when not explicitly configured. */
export const DEFAULT_FOCUS_FRAMES_MAX_SIZE = 12;

/**
 * Groups consecutive emphasized line numbers into highlight regions.
 *
 * @param emphasizedLines - Map of line numbers to their emphasis metadata
 * @returns Sorted array of highlight regions
 */
function groupHighlightRegions(emphasizedLines: Map<number, EmphasisMeta>): HighlightRegion[] {
  if (emphasizedLines.size === 0) {
    return [];
  }

  const sortedLines = Array.from(emphasizedLines.keys()).sort((a, b) => a - b);
  const regions: HighlightRegion[] = [];

  // Track overrides in three tiers (highest to lowest priority):
  //   1. explicit focus — per-line focus directive (propagatedOverride !== true)
  //   2. propagated focus — multiline focus range (propagatedOverride === true)
  //   3. non-focus — highlight directives without focus
  // Within each tier, first-in-region wins (??=).
  interface OverrideChannels {
    explicitFocusPadding: number | undefined;
    propagatedFocusPadding: number | undefined;
    nonFocusPadding: number | undefined;
    explicitFocusMaxSize: number | undefined;
    propagatedFocusMaxSize: number | undefined;
    nonFocusMaxSize: number | undefined;
  }

  function emptyChannels(): OverrideChannels {
    return {
      explicitFocusPadding: undefined,
      propagatedFocusPadding: undefined,
      nonFocusPadding: undefined,
      explicitFocusMaxSize: undefined,
      propagatedFocusMaxSize: undefined,
      nonFocusMaxSize: undefined,
    };
  }

  function accumulateOverrides(ch: OverrideChannels, meta: EmphasisMeta | undefined): void {
    if (meta?.paddingFrameMaxSize !== undefined) {
      if (meta.focus) {
        if (meta.propagatedOverride) {
          ch.propagatedFocusPadding ??= meta.paddingFrameMaxSize;
        } else {
          ch.explicitFocusPadding ??= meta.paddingFrameMaxSize;
        }
      } else {
        ch.nonFocusPadding ??= meta.paddingFrameMaxSize;
      }
    }
    if (meta?.focusFramesMaxSize !== undefined) {
      if (meta.focus) {
        if (meta.propagatedOverride) {
          ch.propagatedFocusMaxSize ??= meta.focusFramesMaxSize;
        } else {
          ch.explicitFocusMaxSize ??= meta.focusFramesMaxSize;
        }
      } else {
        ch.nonFocusMaxSize ??= meta.focusFramesMaxSize;
      }
    }
  }

  function resolvePadding(ch: OverrideChannels): number | undefined {
    return ch.explicitFocusPadding ?? ch.propagatedFocusPadding ?? ch.nonFocusPadding;
  }

  function resolveMaxSize(ch: OverrideChannels): number | undefined {
    return ch.explicitFocusMaxSize ?? ch.propagatedFocusMaxSize ?? ch.nonFocusMaxSize;
  }

  let regionStart = sortedLines[0];
  let regionEnd = sortedLines[0];
  const firstMeta = emphasizedLines.get(sortedLines[0]);
  let hasFocus = firstMeta?.focus ?? false;
  let hasLineHighlight = firstMeta?.lineHighlight ?? false;
  let ch = emptyChannels();
  accumulateOverrides(ch, firstMeta);

  for (let i = 1; i < sortedLines.length; i += 1) {
    const line = sortedLines[i];
    if (line === regionEnd + 1) {
      // Consecutive line, extend current region
      regionEnd = line;
      const meta = emphasizedLines.get(line);
      if (meta?.focus) {
        hasFocus = true;
      }
      if (meta?.lineHighlight) {
        hasLineHighlight = true;
      }
      accumulateOverrides(ch, meta);
    } else {
      // Gap found, close current region and start a new one
      regions.push({
        startLine: regionStart,
        endLine: regionEnd,
        index: regions.length,
        focused: hasFocus,
        hasLineHighlight,
        paddingFrameMaxSize: resolvePadding(ch),
        focusFramesMaxSize: resolveMaxSize(ch),
      });
      regionStart = line;
      regionEnd = line;
      const meta = emphasizedLines.get(line);
      hasFocus = meta?.focus ?? false;
      hasLineHighlight = meta?.lineHighlight ?? false;
      ch = emptyChannels();
      accumulateOverrides(ch, meta);
    }
  }

  // Close the last region
  regions.push({
    paddingFrameMaxSize: resolvePadding(ch),
    startLine: regionStart,
    endLine: regionEnd,
    index: regions.length,
    focused: hasFocus,
    hasLineHighlight,
    focusFramesMaxSize: resolveMaxSize(ch),
  });

  return regions;
}

/**
 * Determines the focused region index.
 * Returns the region explicitly marked with `focus: true`, or the first region.
 *
 * @param regions - Highlight regions
 * @returns The index of the focused region
 */
function determineFocusedRegionIndex(regions: HighlightRegion[]): number {
  const focusedIndex = regions.findIndex((r) => r.focused);
  return focusedIndex >= 0 ? focusedIndex : 0;
}

/**
 * Calculates padding sizes for the focused highlight region.
 *
 * @param region - The focused highlight region
 * @param prevRegionEnd - End line of the previous highlight region (or 0)
 * @param nextRegionStart - Start line of the next highlight region (or totalLines + 1)
 * @param paddingFrameMaxSize - Per-region padding size (or from global options if undefined)
 * @param focusFramesMaxSize - Global focus frames max size option
 * @returns Padding sizes [paddingTop, paddingBottom]
 */

function calculatePadding(
  region: HighlightRegion,
  prevRegionEnd: number,
  nextRegionStart: number,
  paddingFrameMaxSize: number | undefined,
  focusFramesMaxSize: number | undefined,
): [number, number] {
  // Use per-region padding, fallback to 0 if not specified
  const padding = paddingFrameMaxSize ?? 0;

  if (padding <= 0) {
    return [0, 0];
  }

  const highlightSize = region.endLine - region.startLine + 1;

  let paddingTop = padding;
  let paddingBottom = padding;
  // Apply focusFramesMaxSize constraint
  if (focusFramesMaxSize !== undefined) {
    const remaining = focusFramesMaxSize - highlightSize;
    if (remaining <= 0) {
      return [0, 0];
    }
    paddingTop = Math.min(paddingTop, Math.floor(remaining / 2));
    paddingBottom = Math.min(paddingBottom, Math.ceil(remaining / 2));
  }

  // Clamp to available lines before the highlight (don't overlap previous region)
  const availableBefore = region.startLine - 1 - prevRegionEnd;
  paddingTop = Math.min(paddingTop, Math.max(0, availableBefore));

  // Clamp to available lines after the highlight (don't overlap next region)
  const availableAfter = nextRegionStart - 1 - region.endLine;
  paddingBottom = Math.min(paddingBottom, Math.max(0, availableAfter));

  return [paddingTop, paddingBottom];
}

/**
 * When the focused region exceeds focusFramesMaxSize, determines the
 * sub-window from the start of the region that stays focused.
 *
 * @returns [focusStart, focusEnd] (1-based, inclusive) or null if no split needed
 */
function calculateFocusWindow(
  region: HighlightRegion,
  focusFramesMaxSize: number | undefined,
): [number, number] | null {
  if (focusFramesMaxSize === undefined || focusFramesMaxSize < 1) {
    return null;
  }

  const regionSize = region.endLine - region.startLine + 1;
  if (regionSize <= focusFramesMaxSize) {
    return null;
  }

  const focusStart = region.startLine;
  const focusEnd = focusStart + focusFramesMaxSize - 1;

  return [focusStart, focusEnd];
}

/**
 * Calculates frame ranges for the code block based on emphasized lines.
 *
 * This is a pure function that operates on line numbers — no HAST traversal.
 * It groups consecutive highlighted lines into regions, determines the focused
 * region (first by default, or the one with `focus: true`), computes padding
 * for the focused region, and returns an ordered array of frame ranges covering
 * all lines 1 through totalLines.
 *
 * @param emphasizedLines - Map of line numbers to their emphasis metadata
 * @param totalLines - Total number of lines in the code block
 * @param options - Optional padding configuration
 * @returns Ordered array of frame ranges covering all lines
 */
export function calculateFrameRanges(
  emphasizedLines: Map<number, EmphasisMeta>,
  totalLines: number,
  options: EnhanceCodeEmphasisOptions = {},
): FrameRange[] {
  const effectiveFocusFramesMaxSize = options.focusFramesMaxSize ?? DEFAULT_FOCUS_FRAMES_MAX_SIZE;

  if (
    options.focusFramesMaxSize !== undefined &&
    (!Number.isFinite(options.focusFramesMaxSize) || options.focusFramesMaxSize < 1)
  ) {
    throw new Error(
      `focusFramesMaxSize must be a finite number >= 1, got ${options.focusFramesMaxSize}`,
    );
  }
  if (
    options.paddingFrameMaxSize !== undefined &&
    (!Number.isFinite(options.paddingFrameMaxSize) || options.paddingFrameMaxSize < 0)
  ) {
    throw new Error(
      `paddingFrameMaxSize must be a finite number >= 0, got ${options.paddingFrameMaxSize}`,
    );
  }

  if (totalLines <= 0) {
    return [];
  }

  const regions = groupHighlightRegions(emphasizedLines);

  if (regions.length === 0) {
    // Auto-focus: when no emphasis directives exist, focus from line 1.
    // If focusFramesMaxSize is set and the code exceeds it, truncate.
    const autoFocusMax = effectiveFocusFramesMaxSize;
    if (autoFocusMax !== undefined && totalLines > autoFocusMax) {
      return [
        {
          startLine: 1,
          endLine: autoFocusMax,
          type: 'focus',
          regionIndex: 0,
          truncated: 'visible',
        },
        {
          startLine: autoFocusMax + 1,
          endLine: totalLines,
          type: 'normal',
        },
      ];
    }
    return [{ startLine: 1, endLine: totalLines, type: 'focus', regionIndex: 0 }];
  }

  const focusedIndex = determineFocusedRegionIndex(regions);

  // Calculate focus window split (for oversized regions)
  const focusedRegion = regions[focusedIndex];
  const focusFramesMaxSize = focusedRegion.focusFramesMaxSize ?? effectiveFocusFramesMaxSize;
  const focusWindow = calculateFocusWindow(focusedRegion, focusFramesMaxSize);

  // Calculate padding for the focused region (0 when region is split)
  const prevRegionEnd = focusedIndex > 0 ? regions[focusedIndex - 1].endLine : 0;
  const nextRegionStart =
    focusedIndex < regions.length - 1 ? regions[focusedIndex + 1].startLine : totalLines + 1;

  const [paddingTop, paddingBottom] = calculatePadding(
    focusedRegion,
    prevRegionEnd,
    nextRegionStart,
    focusedRegion.paddingFrameMaxSize ?? options.paddingFrameMaxSize,
    focusFramesMaxSize,
  );
  // Build frame ranges by iterating through all regions
  const frames: FrameRange[] = [];
  let currentLine = 1;

  for (let i = 0; i < regions.length; i += 1) {
    const region = regions[i];
    const isFocused = i === focusedIndex;

    if (isFocused && paddingTop > 0) {
      // Normal lines before padding-top
      const paddingTopStart = region.startLine - paddingTop;
      if (currentLine < paddingTopStart) {
        frames.push({ startLine: currentLine, endLine: paddingTopStart - 1, type: 'normal' });
      }
      // Padding-top frame
      frames.push({
        startLine: paddingTopStart,
        endLine: region.startLine - 1,
        type: 'padding-top',
      });
    } else if (currentLine < region.startLine) {
      // Normal lines before this region
      frames.push({ startLine: currentLine, endLine: region.startLine - 1, type: 'normal' });
    }

    if (isFocused && focusWindow) {
      // Split oversized focused region into unfocused-top + focused-center + unfocused-bottom
      const [focusStart, focusEnd] = focusWindow;
      const hasHighlightOnly = region.hasLineHighlight && !region.focused;
      const unfocusedType: FrameRange['type'] = hasHighlightOnly
        ? 'highlighted-unfocused'
        : 'focus-unfocused';
      const focusedType: FrameRange['type'] = hasHighlightOnly ? 'highlighted' : 'focus';

      if (region.startLine < focusStart) {
        frames.push({
          startLine: region.startLine,
          endLine: focusStart - 1,
          type: unfocusedType,
          regionIndex: i,
          truncated: 'hidden',
        });
      }
      frames.push({
        startLine: focusStart,
        endLine: focusEnd,
        type: focusedType,
        regionIndex: i,
        truncated: 'visible',
      });
      if (focusEnd < region.endLine) {
        frames.push({
          startLine: focusEnd + 1,
          endLine: region.endLine,
          type: unfocusedType,
          regionIndex: i,
          truncated: 'hidden',
        });
      }
    } else {
      // Frame type depends on whether the region has line highlights without focus.
      // When a region has both focus and highlights, the frame is "focus" and
      // individual lines receive data-hl for visual highlighting.
      let frameType: FrameRange['type'];
      if (region.hasLineHighlight && !region.focused) {
        frameType = isFocused ? 'highlighted' : 'highlighted-unfocused';
      } else {
        frameType = isFocused ? 'focus' : 'focus-unfocused';
      }
      frames.push({
        startLine: region.startLine,
        endLine: region.endLine,
        type: frameType,
        regionIndex: i,
      });
    }

    currentLine = region.endLine + 1;

    if (isFocused && paddingBottom > 0) {
      // Padding-bottom frame
      frames.push({
        startLine: currentLine,
        endLine: currentLine + paddingBottom - 1,
        type: 'padding-bottom',
      });
      currentLine = currentLine + paddingBottom;
    }
  }

  // Remaining normal lines after all regions
  if (currentLine <= totalLines) {
    frames.push({ startLine: currentLine, endLine: totalLines, type: 'normal' });
  }

  return frames;
}
