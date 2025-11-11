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
});
