import type { Plugin } from 'unified';
import type { Parent, PhrasingContent, Html, Paragraph } from 'mdast';

// MDX JSX types
interface MdxJsxFlowElement {
  type: 'mdxJsxFlowElement';
  name: string | null;
  attributes: Array<any>;
  children: Array<any>;
}

const META_LINK_TEXTS = ['See Demo', 'See Setup', 'See Types'];

/**
 * Remark plugin that cleans up meta link patterns in markdown.
 *
 * Looks for patterns where a Demo/Types component is followed by a meta link
 * (e.g., "[See Demo]", "[See Setup]", "[See Types]") and optionally a horizontal
 * rule (---). When found, removes the link and any following horizontal rule.
 *
 * This is useful for markdown that will be converted to HTML where the link
 * and separator are distracting on the page.
 *
 * Pattern it matches:
 * ```
 * <DemoSomething />
 *
 * [See Demo](./demos/base/)
 *
 * ---  (optional)
 * ```
 *
 * Gets transformed to:
 * ```
 * <DemoSomething />
 * ```
 *
 * Also matches:
 * ```
 * <TypesSomething />
 *
 * [See Types](./types.md#something)
 *
 * ---  (optional)
 * ```
 */
export const transformMarkdownMetaLinks: Plugin = () => {
  return (tree) => {
    const parent = tree as Parent;
    const children = parent.children;

    for (let i = 0; i < children.length - 1; i += 1) {
      const current = children[i];
      const next = children[i + 1];
      const separator = children[i + 2]; // May not exist

      let hasDemo = false;

      // Check if current node is an HTML element containing a Demo component without .Title
      if (current?.type === 'html') {
        const htmlNode = current as Html;
        hasDemo = htmlNode.value.includes('<Demo') && !htmlNode.value.includes('.Title');
      } else if (current?.type === 'mdxJsxFlowElement') {
        // Check if current node is an MDX JSX element (for imported Demo components)
        const mdxNode = current as MdxJsxFlowElement;
        if (mdxNode.name && mdxNode.name.includes('Demo') && !mdxNode.name.includes('.Title')) {
          hasDemo = true;
        }
      } else if (current?.type === 'paragraph') {
        // Check if paragraph contains only a single HTML node with a Demo component
        const paragraphNode = current as Paragraph;
        if (paragraphNode.children.length === 1 && paragraphNode.children[0].type === 'html') {
          const htmlNode = paragraphNode.children[0] as Html;
          hasDemo = htmlNode.value.includes('<Demo') && !htmlNode.value.includes('.Title');
        } else if (
          paragraphNode.children.length >= 2 &&
          paragraphNode.children[0].type === 'html' &&
          paragraphNode.children[paragraphNode.children.length - 1].type === 'html'
        ) {
          // Check if this looks like a Demo component with opening and closing tags
          const openingTag = paragraphNode.children[0] as Html;
          const closingTag = paragraphNode.children[paragraphNode.children.length - 1] as Html;

          if (
            openingTag.value.includes('<Demo') &&
            !openingTag.value.includes('.Title') &&
            closingTag.value.includes('</Demo')
          ) {
            hasDemo = true;
          }
        } else {
          // Check if paragraph contains any HTML nodes with Demo components (mixed content)
          hasDemo = paragraphNode.children.some((child) => {
            return (
              child.type === 'html' &&
              child.value.includes('<Demo') &&
              !child.value.includes('.Title')
            );
          });
        }
      }

      // Also check for Types components (e.g., <TypesSomething />)
      if (!hasDemo) {
        if (current?.type === 'html') {
          const htmlNode = current as Html;
          hasDemo = htmlNode.value.includes('<Types') && !htmlNode.value.includes('.Title');
        } else if (current?.type === 'mdxJsxFlowElement') {
          const mdxNode = current as MdxJsxFlowElement;
          if (mdxNode.name && mdxNode.name.includes('Types') && !mdxNode.name.includes('.Title')) {
            hasDemo = true;
          }
        } else if (current?.type === 'paragraph') {
          const paragraphNode = current as Paragraph;
          if (paragraphNode.children.length === 1 && paragraphNode.children[0].type === 'html') {
            const htmlNode = paragraphNode.children[0] as Html;
            hasDemo = htmlNode.value.includes('<Types') && !htmlNode.value.includes('.Title');
          } else if (
            paragraphNode.children.length >= 2 &&
            paragraphNode.children[0].type === 'html' &&
            paragraphNode.children[paragraphNode.children.length - 1].type === 'html'
          ) {
            const openingTag = paragraphNode.children[0] as Html;
            const closingTag = paragraphNode.children[paragraphNode.children.length - 1] as Html;

            if (
              openingTag.value.includes('<Types') &&
              !openingTag.value.includes('.Title') &&
              closingTag.value.includes('</Types')
            ) {
              hasDemo = true;
            }
          } else {
            hasDemo = paragraphNode.children.some((child) => {
              return (
                child.type === 'html' &&
                child.value.includes('<Types') &&
                !child.value.includes('.Title')
              );
            });
          }
        }
      }

      if (!hasDemo) {
        continue;
      }

      let removedSomething = false;

      // Check if next node is a paragraph containing a meta link (See Demo, See Setup, See Types)
      if (next?.type === 'paragraph') {
        const hasMetaLink = next.children.some((child: PhrasingContent) => {
          return (
            child.type === 'link' &&
            child.children.some(
              (linkChild) => linkChild.type === 'text' && META_LINK_TEXTS.includes(linkChild.value),
            )
          );
        });

        // Check if there's also a thematic break (---) after the paragraph
        const hasThematicBreak = separator?.type === 'thematicBreak';

        if (hasMetaLink) {
          // Remove the meta link paragraph and any following thematic break
          if (hasThematicBreak) {
            // Remove both the meta link paragraph and the thematic break
            children.splice(i + 1, 2);
            removedSomething = true;
          } else {
            // Remove only the meta link paragraph
            children.splice(i + 1, 1);
            removedSomething = true;
          }
        } else if (hasThematicBreak) {
          // No meta link, but there's a thematic break after the paragraph - remove just the HR
          children.splice(i + 2, 1);
          removedSomething = true;
        }
      }

      // If we removed something, adjust the loop index to prevent skipping
      if (removedSomething) {
        i -= 1;
      }
    }
  };
};
