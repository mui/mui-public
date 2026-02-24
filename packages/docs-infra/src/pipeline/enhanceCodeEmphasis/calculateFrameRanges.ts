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
  /** For text highlighting: the specific text to highlight within the line */
  highlightText?: string;
  /** Whether this line's region is the focused region (for padding) */
  focus?: boolean;
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
  type: 'normal' | 'padding-top' | 'highlighted' | 'highlighted-unfocused' | 'padding-bottom';
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
   * Maximum total number of lines in the focus area (padding-top + highlighted + padding-bottom).
   * When set, padding sizes are reduced so the total focus area fits within this limit.
   * The remainder after subtracting the highlighted size is split: floor(remainder/2) for
   * padding-top and ceil(remainder/2) for padding-bottom.
   */
  focusFramesMaxLength?: number;
}

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

  let regionStart = sortedLines[0];
  let regionEnd = sortedLines[0];
  let hasFocus = emphasizedLines.get(sortedLines[0])?.focus ?? false;

  for (let i = 1; i < sortedLines.length; i += 1) {
    const line = sortedLines[i];
    if (line === regionEnd + 1) {
      // Consecutive line, extend current region
      regionEnd = line;
      if (emphasizedLines.get(line)?.focus) {
        hasFocus = true;
      }
    } else {
      // Gap found, close current region and start a new one
      regions.push({
        startLine: regionStart,
        endLine: regionEnd,
        index: regions.length,
        focused: hasFocus,
      });
      regionStart = line;
      regionEnd = line;
      hasFocus = emphasizedLines.get(line)?.focus ?? false;
    }
  }

  // Close the last region
  regions.push({
    startLine: regionStart,
    endLine: regionEnd,
    index: regions.length,
    focused: hasFocus,
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
 * @param totalLines - Total number of lines in the code block
 * @param nextRegionStart - Start line of the next highlight region (or totalLines + 1)
 * @param prevRegionEnd - End line of the previous highlight region (or 0)
 * @param options - Padding configuration options
 * @returns Padding sizes [paddingTop, paddingBottom]
 */
function calculatePadding(
  region: HighlightRegion,
  totalLines: number,
  prevRegionEnd: number,
  nextRegionStart: number,
  options: EnhanceCodeEmphasisOptions,
): [number, number] {
  const { paddingFrameMaxSize = 0, focusFramesMaxLength } = options;

  if (paddingFrameMaxSize <= 0) {
    return [0, 0];
  }

  const highlightSize = region.endLine - region.startLine + 1;

  let paddingTop = paddingFrameMaxSize;
  let paddingBottom = paddingFrameMaxSize;

  // Apply focusFramesMaxLength constraint
  if (focusFramesMaxLength !== undefined) {
    const remaining = focusFramesMaxLength - highlightSize;
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
  if (totalLines <= 0) {
    return [];
  }

  const regions = groupHighlightRegions(emphasizedLines);

  if (regions.length === 0) {
    return [{ startLine: 1, endLine: totalLines, type: 'normal' }];
  }

  const focusedIndex = determineFocusedRegionIndex(regions);

  // Calculate padding for the focused region
  const focusedRegion = regions[focusedIndex];
  const prevRegionEnd = focusedIndex > 0 ? regions[focusedIndex - 1].endLine : 0;
  const nextRegionStart =
    focusedIndex < regions.length - 1 ? regions[focusedIndex + 1].startLine : totalLines + 1;
  const [paddingTop, paddingBottom] = calculatePadding(
    focusedRegion,
    totalLines,
    prevRegionEnd,
    nextRegionStart,
    options,
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

    // Highlighted frame (focused gets 'highlighted', others get 'highlighted-unfocused')
    frames.push({
      startLine: region.startLine,
      endLine: region.endLine,
      type: isFocused ? 'highlighted' : 'highlighted-unfocused',
    });

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
