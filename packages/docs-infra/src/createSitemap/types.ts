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
  parameters?: (string | string[])[];
  returns?: string[];
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
  types?: string[];
  tags?: string[];
  skipDetailSection?: boolean;
  audience?: Audience;
  index?: boolean;
  /**
   * The title of the route-group section this page is listed under in a grouped index
   * (e.g. `Components`), resolved from the page's route group. `null` for a page in a flat
   * index or with no route group, so the field is always present. Useful for
   * grouping/faceting search results.
   */
  section: string | null;
  image?: {
    url: string;
    alt?: string;
  };
}

/**
 * A route-group section heading in a grouped index (see `SitemapSectionData.sections`).
 * Maps a Next.js route group to the human-editable heading its pages are listed under.
 */
export interface PageIndexSection {
  /** The route group this section collects (e.g. `(components)`). */
  group: string;
  /** The (human-editable) heading text shown for the section. */
  title: string;
  /** Heading depth for the section title. Defaults to 2 (`##`). */
  depth?: number;
}

/**
 * Section data from sitemap
 */
export interface SitemapSectionData {
  title: string;
  prefix: string;
  pages: SitemapPage[];
  /**
   * Ordered route-group sections when the index is grouped (its `##` subtitles), so
   * search can recover the sections a page belongs to. An empty array for a flat index,
   * so the field is always present.
   */
  sections: PageIndexSection[];
  /** Heading of the detail-region wrapper in a grouped index (defaults to `Details`). */
  detailsSectionTitle?: string;
}

/**
 * Orama schema property types
 * See: <https://docs.orama.com/docs/orama-js/usage/create#schema-properties-and-types>
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

export type Audience = 'private' | 'introductory' | 'intermediate' | 'advanced' | 'business';

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
     *   Should be paired with `robots: { index: false }` to exclude from public indexing.
     * - `'introductory'`: Content aimed at beginners.
     * - `'intermediate'`: Content aimed at intermediate users.
     * - `'advanced'`: Content aimed at advanced users.
     * - `'business'`: Content aimed at prospective customers and decision-makers
     *   (e.g. marketing pages, pricing, product overviews).
     *
     * @see https://wiki.whatwg.org/wiki/MetaExtensions
     * @see https://brittlebit.org/specifications/html-meta-audience/specification-for-html-meta-element-with-name-value-audience.html
     */
    audience?: Audience;
    [key: string]: unknown;
  };
};
