import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import type { TreeViewDefaultItemModelProperties } from '@mui/x-tree-view/models';
import { escapeHtmlId } from '../utils/escapeHtmlId';

interface FileExplorerProps {
  files: { path: string }[];
  title?: string;
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

const FileExplorer = React.memo(function FileExplorer({ files, title }: FileExplorerProps) {
  const treeItems = React.useMemo(() => buildTreeItems(files), [files]);
  const folderIds = React.useMemo(() => collectFolderIds(treeItems), [treeItems]);

  const [expandedItems, setExpandedItems] = React.useState<string[]>(folderIds);

  React.useEffect(() => {
    setExpandedItems(folderIds);
  }, [folderIds]);

  const handleItemClick = React.useCallback(
    (_event: React.SyntheticEvent, itemId: string) => {
      // Only navigate for leaf items (files, not folders)
      const isFolder = folderIds.includes(itemId);
      if (!isFolder) {
        window.location.hash = `#file-${escapeHtmlId(itemId)}`;
      }
    },
    [folderIds],
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
        onExpandedItemsChange={(_event, itemIds) => setExpandedItems(itemIds)}
        onItemClick={handleItemClick}
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
