import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { toJs } from 'estree-util-to-js';
import { visit } from 'unist-util-visit';
import { transformMarkdownMetadata } from './transformMarkdownMetadata';

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
        },
        openGraph: {
          title: "Button Component",
          description: "A versatile button component for interactive actions."
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
        },
        openGraph: {
          title: "Button Component",
          description: "A versatile button component for interactive actions."
        }
      };
      "
    `);
  });

  it('should fill in openGraph metadata', async () => {
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
        }],
        openGraph: {
          title: "Button Component",
          description: "A versatile button component for interactive actions."
        }
      };
      "
    `);
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
        },
        openGraph: {
          title: "Button Component",
          description: "A versatile button component for interactive actions."
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
        },
        openGraph: {
          title: "Checkbox Component",
          description: "A checkbox component for binary selections."
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
        },
        openGraph: {
          title: "Select Component",
          description: "A \`<select>\` component for choosing options."
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
    // openGraph title should still have the original title (no suffix)
    expect(metadataJs).toContain('title: "Button Component"');
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
});
