const DOCS_DATA_PREFIX = 'docs/data/';
const MATERIAL_UI_COMPONENTS_PREFIX = 'material/components/';
const MATERIAL_UI_PREFIX = 'material/';
const SUPPORTED_DOC_FILE_EXTENSIONS = ['.md', '.mdx', '.js', '.jsx', '.ts', '.tsx', '.json'];

// Material UI page routes are declared independently from their source directories.
// Keep this map in sync with docs/pages/material-ui/* in mui/material-ui.
const MATERIAL_UI_COMPONENT_ROUTE_SEGMENTS = new Map<string, string>([
  ['about-the-lab', 'about-the-lab'],
  ['accordion', 'react-accordion'],
  ['alert', 'react-alert'],
  ['app-bar', 'react-app-bar'],
  ['autocomplete', 'react-autocomplete'],
  ['avatars', 'react-avatar'],
  ['backdrop', 'react-backdrop'],
  ['badges', 'react-badge'],
  ['bottom-navigation', 'react-bottom-navigation'],
  ['box', 'react-box'],
  ['breadcrumbs', 'react-breadcrumbs'],
  ['button-group', 'react-button-group'],
  ['buttons', 'react-button'],
  ['cards', 'react-card'],
  ['checkboxes', 'react-checkbox'],
  ['chips', 'react-chip'],
  ['click-away-listener', 'react-click-away-listener'],
  ['container', 'react-container'],
  ['css-baseline', 'react-css-baseline'],
  ['dialogs', 'react-dialog'],
  ['dividers', 'react-divider'],
  ['drawers', 'react-drawer'],
  ['floating-action-button', 'react-floating-action-button'],
  ['grid', 'react-grid'],
  ['icons', 'icons'],
  ['image-list', 'react-image-list'],
  ['init-color-scheme-script', 'react-init-color-scheme-script'],
  ['links', 'react-link'],
  ['lists', 'react-list'],
  ['masonry', 'react-masonry'],
  ['material-icons', 'material-icons'],
  ['menubar', 'react-menubar'],
  ['menus', 'react-menu'],
  ['modal', 'react-modal'],
  ['no-ssr', 'react-no-ssr'],
  ['number-field', 'react-number-field'],
  ['pagination', 'react-pagination'],
  ['paper', 'react-paper'],
  ['popover', 'react-popover'],
  ['popper', 'react-popper'],
  ['portal', 'react-portal'],
  ['progress', 'react-progress'],
  ['radio-buttons', 'react-radio-button'],
  ['rating', 'react-rating'],
  ['selects', 'react-select'],
  ['skeleton', 'react-skeleton'],
  ['slider', 'react-slider'],
  ['snackbars', 'react-snackbar'],
  ['speed-dial', 'react-speed-dial'],
  ['stack', 'react-stack'],
  ['steppers', 'react-stepper'],
  ['switches', 'react-switch'],
  ['table', 'react-table'],
  ['tabs', 'react-tabs'],
  ['text-fields', 'react-text-field'],
  ['textarea-autosize', 'react-textarea-autosize'],
  ['timeline', 'react-timeline'],
  ['toggle-button', 'react-toggle-button'],
  ['tooltips', 'react-tooltip'],
  ['transfer-list', 'react-transfer-list'],
  ['transitions', 'transitions'],
  ['typography', 'react-typography'],
  ['use-media-query', 'react-use-media-query'],
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
    const routeSegment = MATERIAL_UI_COMPONENT_ROUTE_SEGMENTS.get(componentDirectory);
    return routeSegment ? `/material-ui/${routeSegment}/` : null;
  }

  if (pageDirectory.startsWith(MATERIAL_UI_PREFIX)) {
    return `/material-ui/${pageDirectory.slice(MATERIAL_UI_PREFIX.length)}`;
  }

  return `/${pageDirectory}`;
}
