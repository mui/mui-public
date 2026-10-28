// Default re-export so `LazyContent` can code-split the existing comment renderer:
// `() => import('./CommentLayerChunk')` only runs on the preview path, so the
// renderer (and Base UI's popover) never enters the production bundle.
export { CommentLayer as default } from '../compressed/CommentLayer';
