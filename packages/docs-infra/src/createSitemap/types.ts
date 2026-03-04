import type { Metadata } from 'next';

/**
 * Section data structure from sitemap
 */
export interface SitemapSection {
  title: string;
  children?: Record<string, SitemapSection>;
}

/**
 * Part data structure from sitemap (for component parts)
 */
export interface SitemapPart {
  props?: string[];
  dataAttributes?: string[];
  cssVariables?: string[];
}

/**
 * Export data structure from sitemap (for exported functions/components)
 */
export interface SitemapExport {
  props?: string[];
  dataAttributes?: string[];
  cssVariables?: string[];
}

/**
 * Page data structure from sitemap
 */
export interface SitemapPage {
  title?: string;
  slug: string;
  path: string;
  description?: string;
  keywords?: string[];
  sections?: Record<string, SitemapSection>;
  parts?: Record<string, SitemapPart>;
  exports?: Record<string, SitemapExport>;
  tags?: string[];
  skipDetailSection?: boolean;
  audience?: Audience;
  index?: boolean;
  image?: {
    url: string;
    alt?: string;
  };
}

/**
 * Section data from sitemap
 */
export interface SitemapSectionData {
  title: string;
  prefix: string;
  pages: SitemapPage[];
}

/**
 * Orama schema property types
 * See: https://docs.orama.com/docs/orama-js/usage/create#schema-properties-and-types
 */
export type OramaSchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]'
  | `vector[${number}]`;

/**
 * Sitemap structure
 */
export interface Sitemap {
  schema: Record<string, OramaSchemaType>;
  data: Record<string, SitemapSectionData>;
}

export type Audience = 'private' | 'introductory' | 'intermediate' | 'advanced';

/**
 * Page metadata type extending Next.js `Metadata`.
 *
 * Adds the `audience` field under `other` using the WHATWG MetaExtensions `audience` meta name.
 * All standard Next.js metadata fields (title, description, openGraph, etc.) remain available.
 *
 * @see https://nextjs.org/docs/app/api-reference/functions/generate-metadata#metadata-fields
 */
export type NextMetadata = Metadata & {
  other?: {
    /**
     * Categorize the principal intended audience for the page.
     * Uses the WHATWG MetaExtensions `audience` meta name.
     *
     * When omitted, the page is public and intended for all audiences.
     *
     * - `'private'`: Internal page, not intended for public consumption.
     *   Excluded from public indexing (`robots.index: false`).
     * - `'introductory'`: Content aimed at beginners.
     * - `'intermediate'`: Content aimed at intermediate users.
     * - `'advanced'`: Content aimed at advanced users.
     *
     * @see https://wiki.whatwg.org/wiki/MetaExtensions
     * @see https://brittlebit.org/specifications/html-meta-audience/specification-for-html-meta-element-with-name-value-audience.html
     */
    audience?: Audience;
    [key: string]: unknown;
  };
};
