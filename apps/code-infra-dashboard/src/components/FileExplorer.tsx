import * as React from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { RichTreeViewPro } from '@mui/x-tree-view-pro/RichTreeViewPro';
import { TreeItem, type TreeItemProps } from '@mui/x-tree-view-pro';
import { useTreeItemModel } from '@mui/x-tree-view-pro';
import { escapeHtmlId } from '../utils/html';

export type ChangeType = 'added' | 'removed' | 'modified';

interface TreeViewItem {
  id: string;
  label: string;
  changeType?: ChangeType;
  children?: TreeViewItem[];
}

const SKELETON_ITEMS: TreeViewItem[] = [
  {
    id: 'skel-1',
    label: '',
    children: [
      { id: 'skel-1-1', label: '' },
      { id: 'skel-1-2', label: '' },
      {
        id: 'skel-1-3',
        label: '',
        children: [{ id: 'skel-1-3-1', label: '' }],
      },
    ],
  },
  { id: 'skel-2', label: '' },
  { id: 'skel-3', label: '' },
  { id: 'skel-4', label: '' },
];

const SKELETON_EXPANDED = ['skel-1', 'skel-1-3'];

function SkeletonLabel() {
  return <Skeleton width="80%" />;
}

interface FileExplorerProps {
  files: { path: string; changeType?: ChangeType }[];
  title?: string;
  loading?: boolean;
}

interface TreeNode {
  id: string;
  label: string;
  changeType?: ChangeType;
  children: Map<string, TreeNode>;
}

function buildTreeItems(files: { path: string; changeType?: ChangeType }[]): TreeViewItem[] {
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
      if (isLeaf && file.changeType) {
        current.changeType = file.changeType;
      }
    }
  }

  function toItems(node: TreeNode): TreeViewItem[] {
    const items: TreeViewItem[] = [];
    for (const child of node.children.values()) {
      const item: TreeViewItem = {
        id: child.id,
        label: child.label,
      };
      if (child.changeType) {
        item.changeType = child.changeType;
      }
      if (child.children.size > 0) {
        item.children = toItems(child);
      }
      items.push(item);
    }
    return items;
  }

  return toItems(root);
}

const CHANGE_TYPE_INDICATOR: Record<ChangeType, { label: string; color: string }> = {
  added: { label: '+', color: 'success.main' },
  removed: { label: '\u2212', color: 'error.main' },
  modified: { label: '\u00B1', color: 'text.secondary' },
};

const DiffTreeItem = React.forwardRef<HTMLLIElement, TreeItemProps>(
  function DiffTreeItem(props, ref) {
    const item = useTreeItemModel<TreeViewItem>(props.itemId);
    const changeType = item?.changeType;

    if (!changeType) {
      return <TreeItem {...props} ref={ref} />;
    }

    const { label: indicator, color } = CHANGE_TYPE_INDICATOR[changeType];

    return (
      <TreeItem
        {...props}
        ref={ref}
        label={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <Box
              component="span"
              sx={{
                color,
                fontWeight: 'bold',
                fontSize: '10px',
                lineHeight: 1,
                border: '1px solid',
                borderColor: color,
                borderRadius: '3px',
                px: '3px',
                py: '1px',
              }}
            >
              {indicator}
            </Box>
            {props.label}
          </Box>
        }
      />
    );
  },
);

function collectFolderIds(items: TreeViewItem[]): string[] {
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
  loading,
}: FileExplorerProps) {
  const treeItems = React.useMemo(() => buildTreeItems(files), [files]);
  const folderIds = React.useMemo(() => collectFolderIds(treeItems), [treeItems]);
  const hasChangeTypes = files.some((f) => f.changeType);

  const [expandedItems, setExpandedItems] = React.useState<string[]>(folderIds);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setExpandedItems(folderIds);
  }, [folderIds]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const update = () => {
      const top = el.getBoundingClientRect().top;
      el.style.setProperty('--file-explorer-top', `${top + 16}px`);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

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
      ref={containerRef}
      sx={{
        position: 'sticky',
        top: 16,
        maxHeight: 'calc(100vh - var(--file-explorer-top, 32px))',
        overflow: 'auto',
        minWidth: 250,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {title ? (
        <Typography variant="subtitle2" sx={{ px: 1, pb: 1 }}>
          {title}
        </Typography>
      ) : null}
      <RichTreeViewPro
        items={loading ? SKELETON_ITEMS : treeItems}
        expandedItems={loading ? SKELETON_EXPANDED : expandedItems}
        onExpandedItemsChange={loading ? undefined : (_event, itemIds) => setExpandedItems(itemIds)}
        onItemClick={loading ? undefined : handleItemClick}
        virtualization={!loading}
        slots={hasChangeTypes && !loading ? { item: DiffTreeItem } : undefined}
        slotProps={loading ? { item: { slots: { label: SkeletonLabel } } } : undefined}
        sx={{
          flex: 1,
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
