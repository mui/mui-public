import { z } from 'zod/v4';

export const REPORT_TYPES = ['size-snapshot', 'benchmark'] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const repoSchema = z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format');

export const reportTypeSchema = z.enum(REPORT_TYPES);
