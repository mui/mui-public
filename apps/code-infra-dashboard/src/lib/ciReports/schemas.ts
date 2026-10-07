import { z } from 'zod/v4';
import { REPORT_TYPES } from './timeline';

export const repoSchema = z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format');

export const reportTypeSchema = z.enum(REPORT_TYPES);
