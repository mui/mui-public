import { describe, expect, it, vi } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { toJs } from 'estree-util-to-js';
import { visit } from 'unist-util-visit';
import { transformMarkdownMetadata } from './transformMarkdownMetadata';

// Mock syncPageIndex to capture calls
vi.mock('../syncPageIndex', () => ({
  syncPageIndex: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Helper to extract and stringify the metadata export from an MDX AST
 */
function extractMetadataJs(tree: any): string | null {
  let metadataJs: string | null = null;

  visit(tree, (node: any) => {
    if (node.type === 'mdxjsEsm' && node.data?.estree) {
      const body = node.data.estree.body || [];
      for (const item of body) {
        if (
          item.type === 'ExportNamedDeclaration' &&
          item.declaration?.declarations?.[0]?.id?.name === 'metadata'
        ) {
          // Convert the entire export statement to JavaScript
          const result = toJs({ type: 'Program', body: [item], sourceType: 'module' } as any, {
            handlers: {},
          });
          metadataJs = result.value;
          break;
        }
      }
    }
  });

  return metadataJs;
}

describe('transformMarkdownMetadata integration', () => {
  it('should create metadata export when none exists', async () => {
    const input = `# Button Component

A versatile button component for interactive actions.

## Installation

Install the package...

## Usage

Import and use the button...`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    expect(metadataJs).toMatchInlineSnapshot(`
      "export const metadata = {
        title: "Button Component",
        description: "A versatile button component for interactive actions.",
        descriptionMarkdown: [{
          type: "text",
          value: "A versatile button component for interactive actions.",
          position: {
            start: {
              line: 3,
              column: 1,
              offset: 20
            },
            end: {
              line: 3,
              column: 54,
              offset: 73
            }
          }
        }],
        sections: {
          installation: {
            title: "Installation",
            titleMarkdown: [{
              type: "text",
              value: "Installation",
              position: {
                start: {
                  line: 5,
                  column: 4,
                  offset: 78
                },
                end: {
                  line: 5,
                  column: 16,
                  offset: 90
                }
              }
            }],
            children: {}
          },
          usage: {
            title: "Usage",
            titleMarkdown: [{
              type: "text",
              value: "Usage",
              position: {
                start: {
                  line: 9,
                  column: 4,
                  offset: 119
                },
                end: {
                  line: 9,
                  column: 9,
                  offset: 124
                }
              }
            }],
            children: {}
          }
        }
      };
      "
    `);
  });

  it('should extract sections hierarchy', async () => {
    const input = `# Button Component

A versatile button component for interactive actions.

## Installation

Install the package...

## Usage

### Basic Usage

Simple button example...

### Advanced Usage

Complex button example...`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    expect(metadataJs).toMatchInlineSnapshot(`
      "export const metadata = {
        title: "Button Component",
        description: "A versatile button component for interactive actions.",
        descriptionMarkdown: [{
          type: "text",
          value: "A versatile button component for interactive actions.",
          position: {
            start: {
              line: 3,
              column: 1,
              offset: 20
            },
            end: {
              line: 3,
              column: 54,
              offset: 73
            }
          }
        }],
        sections: {
          installation: {
            title: "Installation",
            titleMarkdown: [{
              type: "text",
              value: "Installation",
              position: {
                start: {
                  line: 5,
                  column: 4,
                  offset: 78
                },
                end: {
                  line: 5,
                  column: 16,
                  offset: 90
                }
              }
            }],
            children: {}
          },
          usage: {
            title: "Usage",
            titleMarkdown: [{
              type: "text",
              value: "Usage",
              position: {
                start: {
                  line: 9,
                  column: 4,
                  offset: 119
                },
                end: {
                  line: 9,
                  column: 9,
                  offset: 124
                }
              }
            }],
            children: {
              "basic-usage": {
                title: "Basic Usage",
                titleMarkdown: [{
                  type: "text",
                  value: "Basic Usage",
                  position: {
                    start: {
                      line: 11,
                      column: 5,
                      offset: 130
                    },
                    end: {
                      line: 11,
                      column: 16,
                      offset: 141
                    }
                  }
                }],
                children: {}
              },
              "advanced-usage": {
                title: "Advanced Usage",
                titleMarkdown: [{
                  type: "text",
                  value: "Advanced Usage",
                  position: {
                    start: {
                      line: 15,
                      column: 5,
                      offset: 173
                    },
                    end: {
                      line: 15,
                      column: 19,
                      offset: 187
                    }
                  }
                }],
                children: {}
              }
            }
          }
        }
      };
      "
    `);
  });

  it('should extract basic metadata without sections', async () => {
    const input = `# Button Component

A versatile button component for interactive actions.`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    expect(metadataJs).toMatchInlineSnapshot(`
      "export const metadata = {
        title: "Button Component",
        description: "A versatile button component for interactive actions.",
        descriptionMarkdown: [{
          type: "text",
          value: "A versatile button component for interactive actions.",
          position: {
            start: {
              line: 3,
              column: 1,
              offset: 20
            },
            end: {
              line: 3,
              column: 54,
              offset: 73
            }
          }
        }]
      };
      "
    `);
  });

  it('should preserve non-breaking spaces in descriptions', async () => {
    // Use \u00a0 (non-breaking space) between "Base" and "UI"
    const input = `# Base\u00a0UI Components

Base\u00a0UI is a library of unstyled React components.

## Installation

Install the package...`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Non-breaking spaces should be preserved (not converted to regular spaces)
    expect(metadataJs).toContain('Base\u00a0UI Components');
    expect(metadataJs).toContain('Base\u00a0UI is a library');
  });

  it('should extract description from JSX component wrapper', async () => {
    const input = `# Button Component

<Description>A versatile button component for interactive actions.</Description>

## Installation

Install the package...`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // When wrapped in JSX, descriptionMarkdown should contain only the children, not the wrapper
    expect(metadataJs).toMatchInlineSnapshot(`
      "export const metadata = {
        title: "Button Component",
        description: "A versatile button component for interactive actions.",
        descriptionMarkdown: [{
          type: "text",
          value: "A versatile button component for interactive actions.",
          position: {
            start: {
              line: 3,
              column: 14,
              offset: 33
            },
            end: {
              line: 3,
              column: 67,
              offset: 86
            }
          }
        }],
        sections: {
          installation: {
            title: "Installation",
            titleMarkdown: [{
              type: "text",
              value: "Installation",
              position: {
                start: {
                  line: 5,
                  column: 4,
                  offset: 105
                },
                end: {
                  line: 5,
                  column: 16,
                  offset: 117
                }
              }
            }],
            children: {}
          }
        }
      };
      "
    `);
  });

  it('should extract description from any component wrapper', async () => {
    const input = `# Checkbox Component

<CustomWrapper>A checkbox component for binary selections.</CustomWrapper>

## Props

The checkbox accepts...`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // When wrapped in JSX, descriptionMarkdown should contain only the children, not the wrapper
    expect(metadataJs).toMatchInlineSnapshot(`
      "export const metadata = {
        title: "Checkbox Component",
        description: "A checkbox component for binary selections.",
        descriptionMarkdown: [{
          type: "text",
          value: "A checkbox component for binary selections.",
          position: {
            start: {
              line: 3,
              column: 16,
              offset: 37
            },
            end: {
              line: 3,
              column: 59,
              offset: 80
            }
          }
        }],
        sections: {
          props: {
            title: "Props",
            titleMarkdown: [{
              type: "text",
              value: "Props",
              position: {
                start: {
                  line: 5,
                  column: 4,
                  offset: 101
                },
                end: {
                  line: 5,
                  column: 9,
                  offset: 106
                }
              }
            }],
            children: {}
          }
        }
      };
      "
    `);
  });

  it('should extract description with nested inline code from JSX component wrapper', async () => {
    const input = `# Select Component

<Description>A \`<select>\` component for choosing options.</Description>

## Props`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();

    // When wrapped in JSX, descriptionMarkdown should contain only the children (which includes the inlineCode nodes)
    // This preserves the inline code formatting in the markdown representation
    expect(metadataJs).toMatchInlineSnapshot(`
      "export const metadata = {
        title: "Select Component",
        description: "A \`<select>\` component for choosing options.",
        descriptionMarkdown: [{
          type: "text",
          value: "A ",
          position: {
            start: {
              line: 3,
              column: 14,
              offset: 33
            },
            end: {
              line: 3,
              column: 16,
              offset: 35
            }
          }
        }, {
          type: "inlineCode",
          value: "<select>",
          position: {
            start: {
              line: 3,
              column: 16,
              offset: 35
            },
            end: {
              line: 3,
              column: 26,
              offset: 45
            }
          }
        }, {
          type: "text",
          value: " component for choosing options.",
          position: {
            start: {
              line: 3,
              column: 26,
              offset: 45
            },
            end: {
              line: 3,
              column: 58,
              offset: 77
            }
          }
        }],
        sections: {
          props: {
            title: "Props",
            titleMarkdown: [{
              type: "text",
              value: "Props",
              position: {
                start: {
                  line: 5,
                  column: 4,
                  offset: 96
                },
                end: {
                  line: 5,
                  column: 9,
                  offset: 101
                }
              }
            }],
            children: {}
          }
        }
      };
      "
    `);
  });

  it('should handle JSX component with attributes', async () => {
    const input = `# Advanced Component

<Description className="custom">An advanced component with special features.</Description>

## Features`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should extract description despite component having attributes
    expect(metadataJs).toContain('description: "An advanced component with special features."');
    expect(metadataJs).toContain('title: "Advanced Component"');
  });

  it('should handle multi-line JSX component wrapper', async () => {
    const input = `# Accordion Component

<Subtitle>
  A set of collapsible panels with headings.
</Subtitle>

## Features`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should extract description from multi-line JSX element
    expect(metadataJs).toContain('description: "A set of collapsible panels with headings."');
    expect(metadataJs).toContain('title: "Accordion Component"');
  });

  it('should extract description from Meta tag with lowercase name', async () => {
    const input = `# Accordion Component

<meta name="description" content="A high-quality, unstyled React accordion component that displays a set of collapsible panels with headings." />

Some visible paragraph text that should be ignored.

## Installation`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should use meta tag content instead of visible paragraph
    expect(metadataJs).toContain(
      'description: "A high-quality, unstyled React accordion component that displays a set of collapsible panels with headings."',
    );
    expect(metadataJs).toContain('title: "Accordion Component"');
    // descriptionMarkdown should be empty array since meta tag has no children
    expect(metadataJs).toContain('descriptionMarkdown: []');
  });

  it('should extract description from Meta tag with PascalCase name', async () => {
    const input = `# Button Component

<Meta name="description" content="A versatile button component for user interactions and form submissions." />

The button component provides...

## Props`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should use Meta tag content
    expect(metadataJs).toContain(
      'description: "A versatile button component for user interactions and form submissions."',
    );
    expect(metadataJs).toContain('title: "Button Component"');
  });

  it('should handle meta tag with other name attributes', async () => {
    const input = `# Search Component

<meta name="keywords" content="search, input, filter" />
<meta name="description" content="A powerful search component with filtering capabilities." />

The search component allows...

## Features`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should extract description from meta tag
    expect(metadataJs).toContain(
      'description: "A powerful search component with filtering capabilities."',
    );
    // Should ignore other meta tags for now (keywords could be added later)
    expect(metadataJs).toContain('title: "Search Component"');
  });

  it('should prioritize meta tag over paragraph description', async () => {
    const input = `# Dialog Component

<meta name="description" content="This is the meta description that should be used." />

This is a paragraph description that should be ignored.

## Usage`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Meta tag should take precedence
    expect(metadataJs).toContain(
      'description: "This is the meta description that should be used."',
    );
    expect(metadataJs).not.toContain(
      'description: "This is a paragraph description that should be ignored."',
    );
  });

  it('should prioritize meta tag even when it appears after paragraph', async () => {
    const input = `# Dialog Component

This is a paragraph description that should be ignored.

<meta name="description" content="This is the meta description that should be used." />

## Usage`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Meta tag should take precedence even when it comes after the paragraph
    expect(metadataJs).toContain(
      'description: "This is the meta description that should be used."',
    );
    expect(metadataJs).not.toContain(
      'description: "This is a paragraph description that should be ignored."',
    );
  });

  it('should extract keywords from meta tag', async () => {
    const input = `# Form Component

<meta name="keywords" content="form, input, validation, submit" />

A component for building forms.

## Props`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should extract keywords as an array
    expect(metadataJs).toContain('keywords: ["form", "input", "validation", "submit"]');
  });

  it('should extract both description and keywords from meta tags', async () => {
    const input = `# Card Component

<meta name="description" content="A flexible card component for displaying content." />
<meta name="keywords" content="card, container, content" />

Card content goes here.

## Examples`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    expect(metadataJs).toContain(
      'description: "A flexible card component for displaying content."',
    );
    expect(metadataJs).toContain('keywords: ["card", "container", "content"]');
  });

  it('should handle meta tags appearing later in the document', async () => {
    const input = `# Tabs Component

Some introduction text.

## Installation

Install instructions here.

<meta name="description" content="An accessible tabs component for organizing content." />
<meta name="keywords" content="tabs, navigation, panels" />

## Usage

Usage instructions here.`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should find meta tags even when they appear later
    expect(metadataJs).toContain(
      'description: "An accessible tabs component for organizing content."',
    );
    expect(metadataJs).toContain('keywords: ["tabs", "navigation", "panels"]');
  });

  it('should handle meta tags in different sections', async () => {
    const input = `# Modal Component

## Overview

<meta name="description" content="A modal dialog component for important messages." />

The modal component displays...

## Features

<meta name="keywords" content="modal, dialog, overlay, popup" />

Features list here.`;

    const processor = unified().use(remarkParse).use(remarkMdx).use(transformMarkdownMetadata);

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // Should find meta tags in any section
    expect(metadataJs).toContain('description: "A modal dialog component for important messages."');
    expect(metadataJs).toContain('keywords: ["modal", "dialog", "overlay", "popup"]');
  });

  it('should append titleSuffix to title in exported metadata', async () => {
    const input = `# Button Component

A versatile button component.`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, { titleSuffix: ' | My Site' });

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // The exported title should have the suffix
    expect(metadataJs).toContain('title: "Button Component | My Site"');
  });

  it('should append titleSuffix when updating existing metadata', async () => {
    const input = `export const metadata = {
  keywords: ['button', 'ui'],
};

# Button Component

A versatile button component.`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, { titleSuffix: ' | Base UI' });

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toBeTruthy();
    // The exported title should have the suffix
    expect(metadataJs).toContain('title: "Button Component | Base UI"');
  });

  it('should not append titleSuffix when there is no title', async () => {
    const input = `Some content without a heading.`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, { titleSuffix: ' | My Site' });

    const tree = processor.parse(input);
    const file = { path: '/test/page.mdx', value: input };
    await processor.run(tree, file as any);

    const metadataJs = extractMetadataJs(tree);
    // No metadata should be created since there's no h1 or description
    expect(metadataJs).toBeNull();
  });

  it('should use visible paragraph in extracted index when useVisibleDescription is true', async () => {
    const { syncPageIndex } = await import('../syncPageIndex');
    const mockSyncPageIndex = vi.mocked(syncPageIndex);
    mockSyncPageIndex.mockClear();

    const input = `# Button Component

A versatile button for actions.

<meta name="description" content="SEO optimized button description." />

## Props`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, {
        extractToIndex: {
          include: ['app'],
          exclude: [],
          baseDir: '/test',
          useVisibleDescription: true,
        },
      });

    const tree = processor.parse(input);
    const file = { path: '/test/app/button/page.mdx', value: input };
    await processor.run(tree, file as any);

    // Exported metadata should still use meta tag description
    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toContain('description: "SEO optimized button description."');

    // syncPageIndex should receive the visible paragraph
    expect(mockSyncPageIndex).toHaveBeenCalledTimes(1);
    const callArgs = mockSyncPageIndex.mock.calls[0][0];
    expect(callArgs.metadata?.description).toBe('A versatile button for actions.');
  });

  it('should use meta tag in extracted index when useVisibleDescription is false', async () => {
    const { syncPageIndex } = await import('../syncPageIndex');
    const mockSyncPageIndex = vi.mocked(syncPageIndex);
    mockSyncPageIndex.mockClear();

    const input = `# Checkbox Component

A checkbox for selections.

<meta name="description" content="SEO optimized checkbox description." />

## Props`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, {
        extractToIndex: {
          include: ['app'],
          exclude: [],
          baseDir: '/test',
          useVisibleDescription: false,
        },
      });

    const tree = processor.parse(input);
    const file = { path: '/test/app/checkbox/page.mdx', value: input };
    await processor.run(tree, file as any);

    // Both should use the meta tag description
    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toContain('description: "SEO optimized checkbox description."');

    expect(mockSyncPageIndex).toHaveBeenCalledTimes(1);
    const callArgs = mockSyncPageIndex.mock.calls[0][0];
    expect(callArgs.metadata?.description).toBe('SEO optimized checkbox description.');
  });

  it('should use visible JSX wrapper text in extracted index when useVisibleDescription is true', async () => {
    const { syncPageIndex } = await import('../syncPageIndex');
    const mockSyncPageIndex = vi.mocked(syncPageIndex);
    mockSyncPageIndex.mockClear();

    const input = `# Input Component

<Description>A text input for user entry.</Description>

<Meta name="description" content="SEO optimized input description." />

## Props`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, {
        extractToIndex: {
          include: ['app'],
          exclude: [],
          baseDir: '/test',
          useVisibleDescription: true,
        },
      });

    const tree = processor.parse(input);
    const file = { path: '/test/app/input/page.mdx', value: input };
    await processor.run(tree, file as any);

    // Exported metadata should use meta tag description
    const metadataJs = extractMetadataJs(tree);
    expect(metadataJs).toContain('description: "SEO optimized input description."');

    // syncPageIndex should receive the JSX wrapper text
    expect(mockSyncPageIndex).toHaveBeenCalledTimes(1);
    const callArgs = mockSyncPageIndex.mock.calls[0][0];
    expect(callArgs.metadata?.description).toBe('A text input for user entry.');
  });

  describe('sitemap data injection (indexWrapperComponent)', () => {
    /**
     * Helper to extract a JSX attribute value from a component
     */
    function extractJsxAttribute(tree: any, componentName: string, attrName: string): any {
      let attrValue: any = null;

      visit(tree, (node: any) => {
        if (
          node.type === 'mdxJsxFlowElement' &&
          node.name === componentName &&
          Array.isArray(node.attributes)
        ) {
          for (const attr of node.attributes) {
            if (
              attr &&
              typeof attr === 'object' &&
              attr.type === 'mdxJsxAttribute' &&
              attr.name === attrName
            ) {
              // Handle expression values
              if (
                attr.value &&
                typeof attr.value === 'object' &&
                attr.value.type === 'mdxJsxAttributeValueExpression'
              ) {
                // Parse the JSON value for easier assertions
                try {
                  attrValue = JSON.parse(attr.value.value);
                } catch {
                  attrValue = attr.value.value;
                }
              } else {
                attrValue = attr.value;
              }
              break;
            }
          }
        }
      });

      return attrValue;
    }

    it('should inject sitemap data into wrapper component in autogenerated index file', async () => {
      const input = `# Components

[//]: # 'This section is autogenerated, but the following list can be modified except within the parentheses.'

<PagesIndex>

- [Button](#button) - [Full Docs](./button/page.mdx)
- [Checkbox](#checkbox) - [Full Docs](./checkbox/page.mdx)

[//]: # 'This section is autogenerated, DO NOT EDIT AFTER THIS LINE'

## Button

A clickable button component.

- Keywords: button, click, action

## Checkbox

A toggleable checkbox input.

- Keywords: checkbox, toggle, input

</PagesIndex>

[//]: # 'The above section is autogenerated, but the remainder of the file can be modified.'

export const metadata = {
  robots: 'index, follow',
};`;

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: ['app'],
            exclude: [],
            baseDir: '/project/docs',
            indexWrapperComponent: 'PagesIndex',
          },
        });

      const tree = processor.parse(input);
      const file = { path: '/project/docs/app/components/page.mdx', value: input };
      await processor.run(tree, file as any);

      // Extract the data prop from PagesIndex
      const sitemapData = extractJsxAttribute(tree, 'PagesIndex', 'data');

      expect(sitemapData).toBeTruthy();
      expect(sitemapData.title).toBe('Components');
      expect(sitemapData.prefix).toBe('/components/');
      expect(sitemapData.pages).toHaveLength(2);
      expect(sitemapData.pages[0]).toMatchObject({
        title: 'Button',
        slug: 'button',
        path: './button/page.mdx',
        description: 'A clickable button component.',
      });
      expect(sitemapData.pages[1]).toMatchObject({
        title: 'Checkbox',
        slug: 'checkbox',
        path: './checkbox/page.mdx',
        description: 'A toggleable checkbox input.',
      });
    });

    it('should not inject data if file is not an autogenerated index', async () => {
      const input = `# Button Component

<PagesIndex>
Some content
</PagesIndex>

## Usage`;

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: ['app'],
            exclude: [],
            indexWrapperComponent: 'PagesIndex',
          },
        });

      const tree = processor.parse(input);
      const file = { path: '/test/page.mdx', value: input };
      await processor.run(tree, file as any);

      // Should not have data prop since this isn't an autogenerated file
      const sitemapData = extractJsxAttribute(tree, 'PagesIndex', 'data');
      expect(sitemapData).toBeNull();
    });

    it('should handle missing wrapper component gracefully', async () => {
      const input = `# Components

[//]: # 'This section is autogenerated, but the following list can be modified except within the parentheses.'

- [Button](#button) - [Full Docs](./button/page.mdx)

[//]: # 'This section is autogenerated, DO NOT EDIT AFTER THIS LINE'

## Button

A button component.`;

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: ['app'],
            exclude: [],
            indexWrapperComponent: 'PagesIndex', // Component not in file
          },
        });

      const tree = processor.parse(input);
      const file = { path: '/test/page.mdx', value: input };

      // Should not throw
      await expect(processor.run(tree, file as any)).resolves.not.toThrow();
    });

    it('should compute prefix from path without baseDir', async () => {
      const input = `# Utilities

[//]: # 'This section is autogenerated, but the following list can be modified except within the parentheses.'

<PagesIndex>

- [Helpers](#helpers) - [Full Docs](./helpers/page.mdx)

[//]: # 'This section is autogenerated, DO NOT EDIT AFTER THIS LINE'

## Helpers

Helper functions.

</PagesIndex>`;

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: ['app'],
            exclude: [],
            indexWrapperComponent: 'PagesIndex',
            // No baseDir - uses full path but still filters src/app
          },
        });

      const tree = processor.parse(input);
      // Use a path that starts with src/app after some project root
      const file = { path: '/project/src/app/utils/page.mdx', value: input };
      await processor.run(tree, file as any);

      const sitemapData = extractJsxAttribute(tree, 'PagesIndex', 'data');

      expect(sitemapData).toBeTruthy();
      expect(sitemapData.title).toBe('Utilities');
      // When no baseDir is provided, 'project' is kept but 'src' and 'app' are still filtered
      expect(sitemapData.prefix).toBe('/project/utils/');
    });

    it('should filter out Next.js route groups from prefix', async () => {
      const input = `# Public Components

[//]: # 'This section is autogenerated, but the following list can be modified except within the parentheses.'

<PagesIndex>

- [Widget](#widget) - [Full Docs](./widget/page.mdx)

[//]: # 'This section is autogenerated, DO NOT EDIT AFTER THIS LINE'

## Widget

A widget component.

</PagesIndex>`;

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: ['app'],
            exclude: [],
            baseDir: '/docs',
            indexWrapperComponent: 'PagesIndex',
          },
        });

      const tree = processor.parse(input);
      const file = { path: '/docs/app/(public)/components/page.mdx', value: input };
      await processor.run(tree, file as any);

      const sitemapData = extractJsxAttribute(tree, 'PagesIndex', 'data');

      expect(sitemapData).toBeTruthy();
      // Route group '(public)' should be filtered out
      expect(sitemapData.prefix).toBe('/components/');
    });

    it('should include page metadata like keywords and tags', async () => {
      const input = `# API Reference

[//]: # 'This section is autogenerated, but the following list can be modified except within the parentheses.'

<ComponentsIndex>

- [useHook](#usehook) [New] - [Full Docs](./use-hook/page.mdx)

[//]: # 'This section is autogenerated, DO NOT EDIT AFTER THIS LINE'

## useHook

A custom React hook.

- Keywords: hook, react, state

</ComponentsIndex>`;

      const processor = unified()
        .use(remarkParse)
        .use(remarkMdx)
        .use(transformMarkdownMetadata, {
          extractToIndex: {
            include: ['api'],
            exclude: [],
            indexWrapperComponent: 'ComponentsIndex',
          },
        });

      const tree = processor.parse(input);
      const file = { path: '/test/api/page.mdx', value: input };
      await processor.run(tree, file as any);

      const sitemapData = extractJsxAttribute(tree, 'ComponentsIndex', 'data');

      expect(sitemapData).toBeTruthy();
      expect(sitemapData.pages[0].keywords).toEqual(['hook', 'react', 'state']);
      expect(sitemapData.pages[0].tags).toEqual(['New']);
    });
  });

  it('should set private flag when page has robots index false', async () => {
    const { syncPageIndex } = await import('../syncPageIndex');
    const mockSyncPageIndex = vi.mocked(syncPageIndex);
    mockSyncPageIndex.mockClear();

    const input = `# Button Component

A versatile button for actions.

## Props

export const metadata = {
  robots: {
    index: false,
  },
};`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, {
        extractToIndex: {
          include: ['app'],
          exclude: [],
          baseDir: '/test',
        },
      });

    const tree = processor.parse(input);
    const file = { path: '/test/app/button/page.mdx', value: input };
    await processor.run(tree, file as any);

    expect(mockSyncPageIndex).toHaveBeenCalledTimes(1);
    const callArgs = mockSyncPageIndex.mock.calls[0][0];
    expect(callArgs.metadata?.private).toBe(true);
  });

  it('should not set private flag when page has robots index true', async () => {
    const { syncPageIndex } = await import('../syncPageIndex');
    const mockSyncPageIndex = vi.mocked(syncPageIndex);
    mockSyncPageIndex.mockClear();

    const input = `# Button Component

A versatile button for actions.

## Props

export const metadata = {
  robots: {
    index: true,
  },
};`;

    const processor = unified()
      .use(remarkParse)
      .use(remarkMdx)
      .use(transformMarkdownMetadata, {
        extractToIndex: {
          include: ['app'],
          exclude: [],
          baseDir: '/test',
        },
      });

    const tree = processor.parse(input);
    const file = { path: '/test/app/button/page.mdx', value: input };
    await processor.run(tree, file as any);

    expect(mockSyncPageIndex).toHaveBeenCalledTimes(1);
    const callArgs = mockSyncPageIndex.mock.calls[0][0];
    expect(callArgs.metadata?.private).toBeUndefined();
  });
});
