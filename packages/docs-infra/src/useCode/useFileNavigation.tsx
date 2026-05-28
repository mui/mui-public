import * as React from 'react';
import { decodeHastSource } from '../pipeline/loadIsomorphicCodeVariant/decodeHastSource';
import type {
  VariantCode,
  VariantSource,
  Code,
  SourceEnhancers,
  SourceComments,
} from '../CodeHighlighter/types';
import { useUrlHashState } from '../useUrlHashState';
import { countLines } from '../pipeline/parseSource/addLineGutters';
import { getLanguageFromExtension } from '../pipeline/loaderUtils/getLanguageFromExtension';
import type { TransformedFiles } from './useCodeUtils';
import { getVariantFileLineCounts } from './sourceLineCounts';
import type { SetSource } from './useSourceEditing';
import { Pre } from './Pre';
import { useSourceEnhancing } from './useSourceEnhancing';
import { toKebabCase } from '../pipeline/loaderUtils/toKebabCase';
import { generateFileSlug } from '../pipeline/loaderUtils/generateFileSlug';

/**
 * Gets the language from a filename by extracting its extension.
 * @param fileName - The filename (e.g., 'index.tsx', 'styles.css')
 * @returns The language name or undefined
 */
function getLanguageFromFileName(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined;
  }
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return undefined;
  }
  const extension = fileName.substring(lastDotIndex);
  return getLanguageFromExtension(extension);
}

/**
 * Checks if the URL hash is relevant to a specific demo
 * Hash format is: {mainSlug}:{variantName}:{fileName} or {mainSlug}:{fileName}
 * @param urlHash - The URL hash (without '#')
 * @param mainSlug - The main slug for the demo
 * @returns true if the hash starts with the demo's slug
 */
export function isHashRelevantToDemo(urlHash: string | null, mainSlug?: string): boolean {
  if (!urlHash || !mainSlug) {
    return false;
  }
  const kebabSlug = toKebabCase(mainSlug);
  return urlHash.startsWith(`${kebabSlug}:`);
}

function getPreRenderKey(
  slug: string | undefined,
  enhancementPhase: 'plain' | 'base' | 'enhanced' = 'plain',
): string {
  // Intentionally keyed only on the canonical file slug (and enhancement
  // phase). Transforms (e.g. JS↔TS) swap the *content* of the same file —
  // including `selectedTransform` here would unmount/remount `<Pre>` on
  // every transform toggle, dropping scroll position, focus, and any
  // IO/RO-driven UI state. Slugs are already built from the original
  // (pre-transform) file name, so the key stays stable across transforms.
  return `${slug ?? 'code'}:${enhancementPhase}`;
}

interface UseFileNavigationProps {
  selectedVariant: VariantCode | null;
  transformedFiles: TransformedFiles | undefined;
  selectedTransform?: string | null;
  mainSlug?: string;
  selectedVariantKey?: string;
  variantKeys?: string[];
  shouldHighlight: boolean;
  preClassName?: string;
  setSource?: SetSource;
  effectiveCode?: Code;
  selectVariant?: React.Dispatch<React.SetStateAction<string>>;
  fileHashMode?: 'remove-hash' | 'remove-filename';
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
  saveVariantToLocalStorage?: (variant: string) => void;
  hashVariant?: string | null;
  /**
   * Array of enhancer functions to apply to parsed HAST sources.
   * Enhancers receive the HAST root, comments extracted from source, and filename.
   */
  sourceEnhancers?: SourceEnhancers;
  /**
   * Whether the surrounding code block is currently expanded. Forwarded to
   * `<Pre>` so it can disable collapsed-state behaviors (e.g. `minColumn`).
   */
  expanded?: boolean;
  /**
   * Called when the user attempts to navigate the caret past the visible
   * region of a collapsed code block. Forwarded to `<Pre>`.
   */
  expand?: () => void;
  /**
   * State of an in-flight transform animation, or `null` when
   * settled. Forwarded to `<Pre>` so it can expose a
   * `data-transforming` attribute (`'collapsed'` / `'expanding'` /
   * `'expanded'` / `'collapsing'`) for CSS-driven exit/entry
   * animations gated on a paused-then-active handshake.
   */
  transforming?: 'collapsed' | 'expanding' | 'expanded' | 'collapsing' | null;
  /**
   * Forwarded to `<Pre>` as `onTransitionReady`. Fired once the
   * paused `transforming` value has fully reconciled — highlighted
   * HAST committed and the visible-frame set settled — plus one
   * animation frame, so the caller can advance to the matching
   * active value.
   */
  onPreTransitionReady?: () => void;
  /**
   * Controls which line-count metric `<Pre>` uses when computing the
   * variant bridge `.collapse` delta:
   *   - `'focus'`: while collapsed, compare `focusedLines`; while
   *     expanded, compare `totalLines`.
   *   - `'total'`: always compare `totalLines` regardless of
   *     collapsed/expanded state.
   */
  variantBridgeLineMode?: 'focus' | 'total';
  /**
   * Partner variant whose per-file line counts feed `<Pre>`'s
   * bridge `.collapse` placeholder during a variant swap. When set,
   * each rendered `<Pre>` receives a `swapTarget` prop derived from
   * the matching file in this variant; when `null`, `swapTarget` is
   * `null` and `<Pre>` falls back to its normal render path.
   *
   * The partner is the *other* side of the in-flight swap:
   *   - During `'collapsed'` / `'expanding'`: the incoming variant.
   *   - During `'expanded'` / `'collapsing'`: the outgoing variant we just left.
   */
  swapPartnerVariant?: VariantCode | null;
  /**
   * Currently-selected file name. The hook is always controlled —
   * callers (typically `useCode`) own the state so it can be read
   * upstream of `useFileNavigation` to drive transform-management
   * decisions.
   */
  selectedFileName: string | undefined;
  /**
   * Setter for `selectedFileName`. Called by the hook in response to
   * hash changes, variant switches, and `selectFileName` invocations.
   */
  setSelectedFileName: React.Dispatch<React.SetStateAction<string | undefined>>;
}

export interface UseFileNavigationResult {
  selectedFileName: string | undefined;
  selectedFileUrl: string | undefined;
  /**
   * Slug for the currently selected file, derived from the canonical
   * (original) file name. Transforms are a view preference applied after
   * navigation, so transformed files do not get their own slug — the slug
   * for `Counter.tsx` remains the same whether the `js` transform is
   * active or not.
   */
  selectedFileSlug: string | undefined;
  selectedFile: VariantSource | null;
  selectedFileComponent: React.ReactNode;
  selectedFileLines: number;
  files: Array<{ name: string; slug?: string; component: React.ReactNode }>;
  selectFileName: (fileName: string) => void;
  allFilesSlugs: Array<{ fileName: string; slug: string; variantName: string }>;
}

/**
 * Hook for managing file selection and navigation within a code variant
 */
export function useFileNavigation({
  selectedVariant,
  transformedFiles,
  // Note: `selectedTransform` is accepted as a prop (callers spread the
  // result of `useTransformManagement`) but intentionally not destructured
  // here — the rendered <Pre> children come from `transformedFiles` /
  // `selectedFile`, which already reflect the active transform. Keying or
  // memo-deping on the transform name would only cause unnecessary
  // remounts on transform toggles.
  mainSlug = '',
  selectedVariantKey = '',
  variantKeys = [],
  shouldHighlight,
  preClassName,
  setSource,
  effectiveCode,
  selectVariant,
  fileHashMode = 'remove-hash',
  saveHashVariantToLocalStorage = 'on-interaction',
  saveVariantToLocalStorage,
  hashVariant,
  sourceEnhancers,
  expanded,
  expand,
  transforming,
  onPreTransitionReady,
  variantBridgeLineMode,
  swapPartnerVariant,
  selectedFileName: selectedFileNameInternal,
  setSelectedFileName: setSelectedFileNameInternal,
}: UseFileNavigationProps): UseFileNavigationResult {
  // Use the simplified URL hash hook
  const [hash, setHash] = useUrlHashState();

  // Track if we're waiting for a variant switch to complete, and which file to select after
  const pendingFileSelection = React.useRef<string | null>(null);
  const justCompletedPendingSelection = React.useRef(false);

  // Track the previous variant key to detect user-initiated changes
  const prevVariantKeyRef = React.useRef(selectedVariantKey);
  const [prevVariantKeyState, setPrevVariantKeyState] = React.useState(selectedVariantKey);
  const isInitialMount = React.useRef(true);

  // Detect if the current variant change was driven by a hash change
  // A variant change is hash-driven if the hash has a variant that matches where we're going
  // AND we weren't already on that variant (i.e., the hash is what triggered the change)
  const [prevHashVariant, setPrevHashVariant] = React.useState<string | null>(hashVariant || null);
  const isHashDrivenVariantChange =
    hashVariant === selectedVariantKey && prevVariantKeyState !== selectedVariantKey;

  // Update prevHashVariant when hashVariant changes
  React.useEffect(() => {
    if (hashVariant !== prevHashVariant) {
      setPrevHashVariant(hashVariant || null);
    }
  }, [hashVariant, prevHashVariant]);

  // Update prevVariantKeyState when variant changes
  React.useEffect(() => {
    if (selectedVariantKey !== prevVariantKeyState) {
      setPrevVariantKeyState(selectedVariantKey);
    }
  }, [selectedVariantKey, prevVariantKeyState]);

  // Helper function to check URL hash and switch to matching file
  const checkUrlHashAndSelectFile = React.useCallback(() => {
    if (!hash) {
      return;
    }

    // Try to find matching file - check current variant first
    let matchingFileName: string | undefined;
    let matchingVariantKey: string | undefined;

    // Step 1: Check current variant (if we have one)
    if (selectedVariant) {
      // Check main file
      if (selectedVariant.fileName) {
        const mainFileSlug = generateFileSlug(
          mainSlug,
          selectedVariant.fileName,
          selectedVariantKey,
        );
        if (hash === mainFileSlug) {
          matchingFileName = selectedVariant.fileName;
          matchingVariantKey = selectedVariantKey;
        }
      }

      // Check extra files
      if (!matchingFileName && selectedVariant.extraFiles) {
        for (const fileName of Object.keys(selectedVariant.extraFiles)) {
          const fileSlug = generateFileSlug(mainSlug, fileName, selectedVariantKey);
          if (hash === fileSlug) {
            matchingFileName = fileName;
            matchingVariantKey = selectedVariantKey;
            break;
          }
        }
      }

      // Check transformed files
      if (!matchingFileName && transformedFiles) {
        for (const file of transformedFiles.files) {
          const fileSlug = generateFileSlug(mainSlug, file.originalName, selectedVariantKey);
          if (hash === fileSlug) {
            matchingFileName = file.originalName;
            matchingVariantKey = selectedVariantKey;
            break;
          }
        }
      }
    }

    // Step 2: If no match and we can switch variants, search other variants
    if (!matchingFileName && effectiveCode && selectVariant) {
      for (const [variantKey, variant] of Object.entries(effectiveCode)) {
        // Skip current variant (already checked) and invalid variants
        if (variantKey === selectedVariantKey || !variant || typeof variant === 'string') {
          continue;
        }

        // Check main file
        if (variant.fileName) {
          const mainFileSlug = generateFileSlug(mainSlug, variant.fileName, variantKey);
          if (hash === mainFileSlug) {
            matchingFileName = variant.fileName;
            matchingVariantKey = variantKey;
            break;
          }
        }

        // Check extra files
        if (!matchingFileName && variant.extraFiles) {
          for (const fileName of Object.keys(variant.extraFiles)) {
            const fileSlug = generateFileSlug(mainSlug, fileName, variantKey);
            if (hash === fileSlug) {
              matchingFileName = fileName;
              matchingVariantKey = variantKey;
              break;
            }
          }
        }

        if (matchingFileName) {
          break;
        }
      }
    }

    if (matchingFileName && matchingVariantKey) {
      // If the matching file is in a different variant, switch to that variant first
      if (matchingVariantKey !== selectedVariantKey && selectVariant) {
        // Remember which file to select after variant switch
        pendingFileSelection.current = matchingFileName;
        selectVariant(matchingVariantKey);
        // Don't set the file here - it will be set after variant changes
        return;
      }

      // Set the file if we're in the correct variant
      pendingFileSelection.current = null;
      setSelectedFileNameInternal(matchingFileName);
    }
  }, [
    hash,
    selectedVariant,
    selectedVariantKey,
    mainSlug,
    transformedFiles,
    effectiveCode,
    selectVariant,
    setSelectedFileNameInternal,
  ]);

  // Run hash check when URL hash changes to select the matching file
  React.useEffect(() => {
    checkUrlHashAndSelectFile();
  }, [checkUrlHashAndSelectFile]);

  // When variant switches with a pending file selection, complete the file selection
  React.useEffect(() => {
    if (pendingFileSelection.current && selectedVariant) {
      const fileToSelect = pendingFileSelection.current;
      pendingFileSelection.current = null;
      justCompletedPendingSelection.current = true;
      setSelectedFileNameInternal(fileToSelect);
    } else {
      justCompletedPendingSelection.current = false;
    }
  }, [selectedVariantKey, selectedVariant, setSelectedFileNameInternal]);

  // Reset selectedFileName when variant changes
  React.useEffect(() => {
    // Skip reset if we have a pending file selection from hash navigation
    // OR if we just completed a pending file selection
    if (pendingFileSelection.current || justCompletedPendingSelection.current) {
      return;
    }

    if (selectedVariant && selectedFileNameInternal !== selectedVariant.fileName) {
      // Only reset if current selectedFileName doesn't exist in the new variant
      const hasFile =
        selectedVariant.fileName === selectedFileNameInternal ||
        (selectedFileNameInternal &&
          selectedVariant.extraFiles &&
          selectedVariant.extraFiles[selectedFileNameInternal]);

      if (!hasFile) {
        setSelectedFileNameInternal(selectedVariant.fileName);
      }
    }
  }, [selectedVariant, selectedFileNameInternal, setSelectedFileNameInternal]);

  // Update hash when variant changes (user-initiated variant switch)
  React.useEffect(() => {
    // Skip on initial mount - let hash-driven navigation handle it
    if (isInitialMount.current) {
      isInitialMount.current = false;
      prevVariantKeyRef.current = selectedVariantKey;
      return;
    }

    // Only update hash if there's already a relevant hash present
    if (typeof window === 'undefined' || !isHashRelevantToDemo(hash, mainSlug)) {
      prevVariantKeyRef.current = selectedVariantKey;
      return;
    }

    // Skip if variant hasn't actually changed
    if (prevVariantKeyRef.current === selectedVariantKey) {
      return;
    }

    // Skip if this is a hash-driven variant change (hash is driving the variant selection)
    if (
      pendingFileSelection.current ||
      justCompletedPendingSelection.current ||
      isHashDrivenVariantChange
    ) {
      prevVariantKeyRef.current = selectedVariantKey;
      return;
    }

    // User switched variants, update hash based on fileHashMode
    // Note: localStorage is already saved by setSelectedVariantKeyAsUser
    if (fileHashMode === 'remove-filename') {
      // Keep variant in hash: mainSlug or mainSlug:variant (for non-Default variants)
      const kebabMainSlug = toKebabCase(mainSlug);
      if (selectedVariantKey === 'Default') {
        setHash(kebabMainSlug);
      } else {
        const kebabVariantName = toKebabCase(selectedVariantKey);
        setHash(`${kebabMainSlug}:${kebabVariantName}`);
      }
    } else {
      // Remove entire hash
      setHash(null);
    }

    prevVariantKeyRef.current = selectedVariantKey;
  }, [selectedVariantKey, hash, mainSlug, fileHashMode, setHash, isHashDrivenVariantChange]);

  // Compute the displayed filename (transformed if applicable)
  const selectedFileName = React.useMemo(() => {
    if (!selectedVariant) {
      return undefined;
    }

    // If selectedFileNameInternal is undefined, we're selecting the main file
    const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
    if (!effectiveFileName) {
      return undefined;
    }

    // If we have transformed files, return the transformed name
    if (transformedFiles) {
      const file = transformedFiles.files.find((f) => f.originalName === effectiveFileName);
      return file ? file.name : effectiveFileName;
    }

    // Otherwise, return the original filename
    return effectiveFileName;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles]);

  // Derive the URL of the currently selected file by combining the variant URL
  // with the selected file's name and (optional) `relativeUrl`. When the
  // selected file is the variant entry, the variant URL is used directly.
  //
  // For an extra file:
  //   - string entry: it is itself a fully-qualified URL.
  //   - object entry with `relativeUrl`: resolve `relativeUrl` against the
  //     variant URL.
  //   - object entry without `relativeUrl`: by the `extraFiles` contract the
  //     key itself resolves to the file URL against the variant URL, so we
  //     resolve the key. Authors who provide a synthetic key for an inline
  //     entry should also avoid setting `variant.url` (or should not consume
  //     `selectedFileUrl`).
  const selectedFileUrl = React.useMemo<string | undefined>(() => {
    if (!selectedVariant?.url) {
      return undefined;
    }

    const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
    if (!effectiveFileName || effectiveFileName === selectedVariant.fileName) {
      return selectedVariant.url;
    }

    const extraFile = selectedVariant.extraFiles?.[effectiveFileName];
    if (typeof extraFile === 'string') {
      // String form is already a fully-qualified URL.
      return extraFile;
    }

    const relativeUrl =
      extraFile && typeof extraFile === 'object' ? extraFile.relativeUrl : undefined;

    try {
      return new URL(relativeUrl ?? effectiveFileName, selectedVariant.url).href;
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `useFileNavigation: failed to derive selectedFileUrl for "${effectiveFileName}" against "${selectedVariant.url}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return undefined;
    }
  }, [selectedVariant, selectedFileNameInternal]);

  // Slug for the currently selected file. Always derived from the canonical
  // (original) file name so that transforms remain a view preference and do
  // not produce a separate URL — clicking a permalink lands on the same
  // file regardless of which transform the visitor has selected.
  const selectedFileSlug = React.useMemo<string | undefined>(() => {
    if (!selectedVariant) {
      return undefined;
    }
    const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
    if (!effectiveFileName) {
      return undefined;
    }
    return generateFileSlug(mainSlug, effectiveFileName, selectedVariantKey);
  }, [selectedVariant, selectedFileNameInternal, mainSlug, selectedVariantKey]);

  const selectedFile = React.useMemo(() => {
    if (!selectedVariant) {
      return null;
    }

    // If we have transformed files, use them
    if (transformedFiles) {
      const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
      const file = transformedFiles.files.find((f) => f.originalName === effectiveFileName);
      return file ? file.source : null;
    }

    // Otherwise, use the original untransformed files
    if (selectedFileNameInternal === selectedVariant.fileName || !selectedFileNameInternal) {
      return selectedVariant.source ?? null;
    }

    // Look in extraFiles
    if (
      selectedFileNameInternal &&
      selectedVariant.extraFiles &&
      selectedVariant.extraFiles[selectedFileNameInternal]
    ) {
      const extraFile = selectedVariant.extraFiles[selectedFileNameInternal];
      if (typeof extraFile === 'string') {
        return extraFile;
      }
      if (extraFile && typeof extraFile === 'object' && 'source' in extraFile) {
        return extraFile.source ?? null;
      }
    }

    return null;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles]);

  // Get comments for the selected file. When a transformed view is
  // active, prefer the transformed file's own `comments` map — it has
  // already been remapped onto the post-transform line numbers by
  // `applyCodeTransformWithComments`, so client-side enhancers see
  // markers that line up with the source they're being handed. Falling
  // back to `selectedVariant.comments` would feed the enhancer the
  // original (pre-transform) line numbers, silently mis-aligning every
  // `@focus` / `@padding-*` marker on transformed renders.
  const selectedFileComments = React.useMemo((): SourceComments | undefined => {
    if (!selectedVariant) {
      return undefined;
    }

    const effectiveFileName = selectedFileNameInternal || selectedVariant.fileName;
    if (!effectiveFileName) {
      return undefined;
    }

    if (transformedFiles) {
      const transformedFile = transformedFiles.files.find(
        (file) => file.originalName === effectiveFileName,
      );
      if (transformedFile) {
        return transformedFile.comments;
      }
    }

    // Check if it's the main file
    if (effectiveFileName === selectedVariant.fileName) {
      return selectedVariant.comments;
    }

    // Check extra files
    if (selectedVariant.extraFiles?.[effectiveFileName]) {
      const extraFile = selectedVariant.extraFiles[effectiveFileName];
      if (typeof extraFile === 'object' && 'comments' in extraFile) {
        return extraFile.comments;
      }
    }

    return undefined;
  }, [selectedVariant, selectedFileNameInternal, transformedFiles]);

  // Apply source enhancers to the selected file
  const { enhancedSource, isEnhancing } = useSourceEnhancing({
    source: selectedFile,
    fileName: selectedFileName,
    comments: selectedFileComments,
    sourceEnhancers,
  });

  // Look up the partner variant's matching-file line counts so `<Pre>`
  // can append a bridge `.collapse` placeholder while a variant swap
  // is in flight. When the same-named file is absent from the partner
  // variant, fall back to the partner's main file — that's what the
  // file-navigation reset will commit to at the swap point (see the
  // "Only reset if current selectedFileName doesn't exist in the new
  // variant" effect above), so the bridge must measure against the
  // same target. Without the fallback the bridge returns `null`, the
  // animation is skipped, and the layout snaps when the swap commits.
  const resolveSwapTarget = React.useCallback(
    (fileName: string | undefined) => {
      if (!swapPartnerVariant || !fileName) {
        return null;
      }
      const counts = getVariantFileLineCounts(swapPartnerVariant, fileName);
      if (counts) {
        return counts;
      }
      const partnerMainFileName =
        'fileName' in swapPartnerVariant ? swapPartnerVariant.fileName : undefined;
      if (!partnerMainFileName || partnerMainFileName === fileName) {
        return null;
      }
      return getVariantFileLineCounts(swapPartnerVariant, partnerMainFileName);
    },
    [swapPartnerVariant],
  );

  const selectedFileComponent = React.useMemo(() => {
    if (!selectedVariant) {
      return null;
    }

    // Determine the source to render:
    // - If enhancers are present, use enhanced source (falls back to selectedFile)
    // - Otherwise use selectedFile directly (which may be from transformed files)
    const sourceToRender =
      sourceEnhancers && sourceEnhancers.length > 0
        ? (enhancedSource ?? selectedFile)
        : selectedFile;

    if (sourceToRender != null) {
      // Determine language: use variant's language for main file, or derive from filename for extra files
      const isMainFile =
        !selectedFileNameInternal || selectedFileNameInternal === selectedVariant.fileName;
      const language = isMainFile
        ? selectedVariant.language
        : getLanguageFromFileName(selectedFileNameInternal);
      const fileName = selectedFileNameInternal || selectedVariant.fileName;
      const fileSlug = generateFileSlug(
        mainSlug,
        selectedFileNameInternal ?? selectedVariant.fileName ?? 'code',
        selectedVariantKey,
      );
      let enhancementPhase: 'plain' | 'base' | 'enhanced' = 'plain';
      if (sourceEnhancers && sourceEnhancers.length > 0) {
        enhancementPhase = isEnhancing ? 'base' : 'enhanced';
      }

      return (
        <Pre
          key={getPreRenderKey(fileSlug, enhancementPhase)}
          className={preClassName}
          fileName={fileName}
          bridgeLineMode={variantBridgeLineMode}
          language={language}
          setSource={setSource}
          shouldHighlight={shouldHighlight}
          expanded={expanded}
          expand={expand}
          transforming={transforming}
          onTransitionReady={onPreTransitionReady}
          swapTarget={resolveSwapTarget(fileName)}
        >
          {sourceToRender}
        </Pre>
      );
    }

    return null;
  }, [
    selectedVariant,
    shouldHighlight,
    preClassName,
    setSource,
    enhancedSource,
    isEnhancing,
    mainSlug,
    selectedFile,
    selectedVariantKey,
    sourceEnhancers,
    selectedFileNameInternal,
    expanded,
    expand,
    transforming,
    onPreTransitionReady,
    variantBridgeLineMode,
    resolveSwapTarget,
  ]);

  const selectedFileLines = React.useMemo(() => {
    if (selectedFile == null) {
      return 0;
    }

    // If it's a string, split by newlines and count
    if (typeof selectedFile === 'string') {
      return selectedFile.split('\n').length;
    }

    // If it's a hast object, count the children length
    const hastSelectedFile = decodeHastSource(selectedFile);
    if (hastSelectedFile) {
      if (hastSelectedFile.data && 'totalLines' in hastSelectedFile.data) {
        const totalLines = hastSelectedFile.data.totalLines;
        // Check if totalLines is a valid number (not null, undefined, or NaN)
        if (totalLines != null && !Number.isNaN(Number(totalLines))) {
          const numLines = Number(totalLines);
          if (numLines >= 0) {
            return numLines;
          }
        }
        // Fall through to children count if totalLines is invalid
      }

      if ('children' in hastSelectedFile) {
        // Use countLines for more accurate line counting of HAST trees
        return countLines(hastSelectedFile);
      }
    }

    return 0;
  }, [selectedFile]);

  // Convert files for the return interface
  const files = React.useMemo(() => {
    if (!selectedVariant) {
      return [];
    }

    // If we have transformed files, use them
    if (transformedFiles) {
      return transformedFiles.files.map((f) => ({
        name: f.name,
        slug: generateFileSlug(mainSlug, f.originalName, selectedVariantKey),
        component: (
          <Pre
            key={getPreRenderKey(generateFileSlug(mainSlug, f.originalName, selectedVariantKey))}
            className={preClassName}
            fileName={f.originalName}
            bridgeLineMode={variantBridgeLineMode}
            setSource={setSource}
            shouldHighlight={shouldHighlight}
            expanded={expanded}
            expand={expand}
            transforming={transforming}
            onTransitionReady={onPreTransitionReady}
            swapTarget={resolveSwapTarget(f.originalName)}
          >
            {f.source}
          </Pre>
        ),
      }));
    }

    // Otherwise, create files from original untransformed data
    const result: Array<{ name: string; slug?: string; component: React.ReactNode }> = [];

    // Only add main file if it has a fileName
    if (selectedVariant.fileName && selectedVariant.source) {
      result.push({
        name: selectedVariant.fileName,
        slug: generateFileSlug(mainSlug, selectedVariant.fileName, selectedVariantKey),
        component: (
          <Pre
            key={getPreRenderKey(
              generateFileSlug(mainSlug, selectedVariant.fileName, selectedVariantKey),
            )}
            className={preClassName}
            fileName={selectedVariant.fileName}
            language={selectedVariant.language}
            setSource={setSource}
            shouldHighlight={shouldHighlight}
            expanded={expanded}
            expand={expand}
            transforming={transforming}
            onTransitionReady={onPreTransitionReady}
            bridgeLineMode={variantBridgeLineMode}
            swapTarget={resolveSwapTarget(selectedVariant.fileName)}
          >
            {selectedVariant.source}
          </Pre>
        ),
      });
    }

    if (selectedVariant.extraFiles) {
      Object.entries(selectedVariant.extraFiles).forEach(([fileName, fileData]) => {
        let source: VariantSource | undefined;
        let language: string | undefined;

        if (typeof fileData === 'string') {
          source = fileData;
        } else if (fileData && typeof fileData === 'object' && 'source' in fileData) {
          source = fileData.source;
          language = fileData.language;
        } else {
          return; // Skip invalid entries
        }

        if (!source) {
          return; // Skip null/undefined sources
        }

        result.push({
          name: fileName,
          slug: generateFileSlug(mainSlug, fileName, selectedVariantKey),
          component: (
            <Pre
              key={getPreRenderKey(generateFileSlug(mainSlug, fileName, selectedVariantKey))}
              className={preClassName}
              fileName={fileName}
              language={language ?? getLanguageFromFileName(fileName)}
              setSource={setSource}
              shouldHighlight={shouldHighlight}
              expanded={expanded}
              expand={expand}
              transforming={transforming}
              onTransitionReady={onPreTransitionReady}
              bridgeLineMode={variantBridgeLineMode}
              swapTarget={resolveSwapTarget(fileName)}
            >
              {source}
            </Pre>
          ),
        });
      });
    }

    return result;
  }, [
    selectedVariant,
    transformedFiles,
    mainSlug,
    selectedVariantKey,
    shouldHighlight,
    preClassName,
    setSource,
    expanded,
    expand,
    transforming,
    onPreTransitionReady,
    variantBridgeLineMode,
    resolveSwapTarget,
  ]);

  // Create a wrapper for selectFileName that handles transformed filenames and URL updates
  const selectFileName = React.useCallback(
    (fileName: string) => {
      if (!selectedVariant) {
        return;
      }

      let targetFileName = fileName;

      // If we have transformed files, we need to reverse-lookup the original filename
      if (transformedFiles) {
        // Check if the fileName is a transformed name - if so, find the original
        const fileByTransformedName = transformedFiles.files.find((f) => f.name === fileName);
        if (fileByTransformedName) {
          targetFileName = fileByTransformedName.originalName;
        } else {
          // Check if the fileName is already an original name
          const fileByOriginalName = transformedFiles.files.find(
            (f) => f.originalName === fileName,
          );
          if (fileByOriginalName) {
            targetFileName = fileName;
          }
        }
      }

      // Handle hash removal based on fileHashMode
      if (typeof window !== 'undefined' && isHashRelevantToDemo(hash, mainSlug)) {
        // Save variant to localStorage if on-interaction mode (clicking a tab counts as interaction)
        if (saveVariantToLocalStorage && saveHashVariantToLocalStorage === 'on-interaction') {
          saveVariantToLocalStorage(selectedVariantKey);
        }

        if (fileHashMode === 'remove-filename') {
          // Keep variant in hash: mainSlug or mainSlug:variant (for non-Default variants)
          const kebabMainSlug = toKebabCase(mainSlug);
          if (selectedVariantKey === 'Default') {
            setHash(kebabMainSlug);
          } else {
            const kebabVariantName = toKebabCase(selectedVariantKey);
            setHash(`${kebabMainSlug}:${kebabVariantName}`);
          }
        } else {
          // Remove entire hash
          setHash(null);
        }
      }

      setSelectedFileNameInternal(targetFileName);
    },
    [
      selectedVariant,
      transformedFiles,
      mainSlug,
      selectedVariantKey,
      fileHashMode,
      hash,
      setHash,
      saveHashVariantToLocalStorage,
      saveVariantToLocalStorage,
      setSelectedFileNameInternal,
    ],
  );

  // Memoized array of all file slugs for all variants
  const allFilesSlugs = React.useMemo(() => {
    const result: Array<{ fileName: string; slug: string; variantName: string }> = [];

    if (!effectiveCode || !variantKeys.length) {
      return result;
    }

    // Iterate through all variants
    for (const variantKey of variantKeys) {
      const variant = effectiveCode[variantKey];

      // Skip invalid variants
      if (!variant || typeof variant === 'string') {
        continue;
      }

      // Add variant-only slug (points to main file of the variant)
      // Skip for Default variant since it doesn't have variant name in hash
      if (variant.fileName && variantKey !== 'Default') {
        const kebabMainSlug = toKebabCase(mainSlug);
        const kebabVariantName = toKebabCase(variantKey);
        const variantOnlySlug = `${kebabMainSlug}:${kebabVariantName}`;

        result.push({
          fileName: variant.fileName,
          slug: variantOnlySlug,
          variantName: variantKey,
        });
      }

      // Add main file if it exists
      if (variant.fileName) {
        result.push({
          fileName: variant.fileName,
          slug: generateFileSlug(mainSlug, variant.fileName, variantKey),
          variantName: variantKey,
        });
      }

      // Add extra files
      if (variant.extraFiles) {
        Object.keys(variant.extraFiles).forEach((fileName) => {
          result.push({
            fileName,
            slug: generateFileSlug(mainSlug, fileName, variantKey),
            variantName: variantKey,
          });
        });
      }
    }

    return result;
  }, [effectiveCode, variantKeys, mainSlug]);

  return {
    selectedFileName,
    selectedFileUrl,
    selectedFileSlug,
    selectedFile,
    selectedFileComponent,
    selectedFileLines,
    files,
    allFilesSlugs,
    selectFileName,
  };
}
