const DOCS_DATA_PREFIX = 'docs/data/';
const MATERIAL_UI_COMPONENTS_PREFIX = 'material/components/';
const MATERIAL_UI_PREFIX = 'material/';
const SUPPORTED_DOC_FILE_EXTENSIONS = ['.md', '.mdx', '.js', '.jsx', '.ts', '.tsx', '.json'];

const MATERIAL_UI_ROUTES_WITHOUT_REACT_PREFIX = new Set([
  'about-the-lab',
  'icons',
  'material-icons',
  'transitions',
]);

const MATERIAL_UI_COMPONENT_ROUTE_ALIASES = new Map([
  ['avatars', 'avatar'],
  ['badges', 'badge'],
  ['buttons', 'button'],
  ['cards', 'card'],
  ['checkboxes', 'checkbox'],
  ['dialogs', 'dialog'],
  ['dividers', 'divider'],
  ['drawers', 'drawer'],
  ['links', 'link'],
  ['lists', 'list'],
  ['menus', 'menu'],
  ['radio-buttons', 'radio-button'],
  ['selects', 'select'],
  ['snackbars', 'snackbar'],
  ['steppers', 'stepper'],
  ['switches', 'switch'],
  ['text-fields', 'text-field'],
  ['tooltips', 'tooltip'],
]);

/**
 * Maps a Material UI documentation source file to its public page path.
 */
export function formatMaterialUiDocPath(filePath: string): string | null {
  if (
    !filePath.startsWith(DOCS_DATA_PREFIX) ||
    !SUPPORTED_DOC_FILE_EXTENSIONS.some((extension) => filePath.endsWith(extension))
  ) {
    return null;
  }

  const fileNameSeparatorIndex = filePath.lastIndexOf('/');
  if (fileNameSeparatorIndex < DOCS_DATA_PREFIX.length) {
    return null;
  }

  const pageDirectory = filePath.slice(DOCS_DATA_PREFIX.length, fileNameSeparatorIndex);
  if (pageDirectory === 'material') {
    return '/material-ui/';
  }

  if (pageDirectory.startsWith(MATERIAL_UI_COMPONENTS_PREFIX)) {
    const componentPath = pageDirectory.slice(MATERIAL_UI_COMPONENTS_PREFIX.length);
    const nestedDirectorySeparatorIndex = componentPath.indexOf('/');
    const componentDirectory =
      nestedDirectorySeparatorIndex === -1
        ? componentPath
        : componentPath.slice(0, nestedDirectorySeparatorIndex);

    // Get from exception route alias collection for plural folders to singlular routes or fallback
    // to normal component directory for other and new components without plural folders to singular routes.
    // This will keep the logic in sync for newly introduced components.
    const routeName =
      MATERIAL_UI_COMPONENT_ROUTE_ALIASES.get(componentDirectory) ?? componentDirectory;
    const routeSegment = MATERIAL_UI_ROUTES_WITHOUT_REACT_PREFIX.has(componentDirectory)
      ? routeName
      : `react-${routeName}`;
    return `/material-ui/${routeSegment}/`;
  }

  if (pageDirectory.startsWith(MATERIAL_UI_PREFIX)) {
    return `/material-ui/${pageDirectory.slice(MATERIAL_UI_PREFIX.length)}`;
  }

  return `/${pageDirectory}`;
}
