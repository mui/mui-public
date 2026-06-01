import { createDemo } from '@/functions/createDemo';
import { CommentedDocument } from './CommentedDocument';

export const DemoChunkCompressed = createDemo(import.meta.url, CommentedDocument);
