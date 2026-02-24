import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import type { TreeViewDefaultItemModelProperties } from '@mui/x-tree-view/models';
import { escapeHtmlId } from '../utils/escapeHtmlId';

interface FileExplorerProps {
  files: { path: string }[];
  title?: string;
  onFileClick?: (filePath: string) => void;
  getItemLabel?: (item: TreeViewDefaultItemModelProperties) => string;
  /** Controlled expanded items. If not provided, all folders are expanded by default. */
  expandedItems?: string[];
  /** Callback when expanded items change. Only used when expandedItems is provided. */
  onExpandedItemsChange?: (itemIds: string[]) => void;
}

interface TreeNode {
  id: string;
  label: string;
  children: Map<string, TreeNode>;
}

function buildTreeItems(files: { path: string }[]): TreeViewDefaultItemModelProperties[] {
  const root: TreeNode = { id: '', label: '', children: new Map() };

  for (const file of files) {
    const segments = file.path.split('/');
    let current = root;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLeaf = i === segments.length - 1;
      const id = isLeaf ? file.path : segments.slice(0, i + 1).join('/');

      if (!current.children.has(segment)) {
        current.children.set(segment, {
          id,
          label: segment,
          children: new Map(),
        });
      }
      current = current.children.get(segment)!;
    }
  }

  function toItems(node: TreeNode): TreeViewDefaultItemModelProperties[] {
    const items: TreeViewDefaultItemModelProperties[] = [];
    for (const child of node.children.values()) {
      const item: TreeViewDefaultItemModelProperties = {
        id: child.id,
        label: child.label,
      };
      if (child.children.size > 0) {
        item.children = toItems(child);
      }
      items.push(item);
    }
    return items;
  }

  return toItems(root);
}

function collectFolderIds(items: TreeViewDefaultItemModelProperties[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      ids.push(item.id);
      ids.push(...collectFolderIds(item.children));
    }
  }
  return ids;
}

const FileExplorer = React.memo(function FileExplorer({
  files,
  title,
  onFileClick,
  getItemLabel,
  expandedItems: expandedItemsProp,
  onExpandedItemsChange,
}: FileExplorerProps) {
  const treeItems = React.useMemo(() => buildTreeItems(files), [files]);
  const folderIds = React.useMemo(() => collectFolderIds(treeItems), [treeItems]);

  // Use internal state if expandedItems prop is not provided
  const isControlled = expandedItemsProp !== undefined;
  const [internalExpandedItems, setInternalExpandedItems] = React.useState<string[]>([]);

  // Initialize internal state with all folders expanded when uncontrolled
  const initializedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isControlled && !initializedRef.current && folderIds.length > 0) {
      initializedRef.current = true;
      setInternalExpandedItems(folderIds);
    }
  }, [isControlled, folderIds]);

  // Reset initialization when files change
  React.useEffect(() => {
    if (!isControlled) {
      initializedRef.current = false;
    }
  }, [files, isControlled]);

  const expandedItems = isControlled ? expandedItemsProp : internalExpandedItems;

  const handleExpandedItemsChange = React.useCallback(
    (_event: React.SyntheticEvent | null, itemIds: string[]) => {
      if (isControlled) {
        onExpandedItemsChange?.(itemIds);
      } else {
        setInternalExpandedItems(itemIds);
      }
    },
    [isControlled, onExpandedItemsChange],
  );

  const handleItemClick = React.useCallback(
    (_event: React.SyntheticEvent, itemId: string) => {
      // Only navigate for leaf items (files, not folders)
      const isFolder = folderIds.includes(itemId);
      if (!isFolder) {
        onFileClick?.(itemId);
        window.location.hash = `#file-${escapeHtmlId(itemId)}`;
      }
    },
    [folderIds, onFileClick],
  );

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 16,
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        minWidth: 250,
      }}
    >
      {title ? (
        <Typography variant="subtitle2" sx={{ px: 1, pb: 1 }}>
          {title}
        </Typography>
      ) : null}
      <RichTreeView
        items={treeItems}
        expandedItems={expandedItems}
        onExpandedItemsChange={handleExpandedItemsChange}
        onItemClick={handleItemClick}
        getItemLabel={getItemLabel}
        sx={{
          '& .MuiTreeItem-label': {
            fontFamily: 'monospace',
            fontSize: '12px',
          },
        }}
      />
    </Box>
  );
});

export default FileExplorer;
