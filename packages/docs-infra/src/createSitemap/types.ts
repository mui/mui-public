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
  title: string;
  path: string;
  description?: string;
  keywords?: string[];
  sections?: Record<string, SitemapSection>;
  parts?: Record<string, SitemapPart>;
  exports?: Record<string, SitemapExport>;
  tags?: string[];
  skipDetailSection?: boolean;
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
