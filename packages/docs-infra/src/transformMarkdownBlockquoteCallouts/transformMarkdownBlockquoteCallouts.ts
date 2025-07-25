import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Blockquote, Text } from 'mdast';

/**
 * Remark plugin that extracts GitHub-style callouts from blockquotes and injects them into data attributes.
 *
 * Transforms blockquotes like:
 * > [!NOTE]
 * > This is a note.
 *
 * Into blockquotes with a custom data attribute that will be preserved when converted to HTML:
 * <blockquote data-callout-type="note">
 *   <p>This is a note.</p>
 * </blockquote>
 *
 * Supported callout types: NOTE, TIP, IMPORTANT, WARNING, CAUTION
 */
const transformMarkdownBlockquoteCallouts: Plugin = () => {
  return (tree) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      // Find the first paragraph in the blockquote
      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== 'paragraph') {
        return;
      }

      // Find the first text node in the paragraph
      const firstTextNode = firstChild.children[0];
      if (!firstTextNode || firstTextNode.type !== 'text') {
        return;
      }

      const textNode = firstTextNode as Text;
      const calloutPattern = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;
      const match = textNode.value.match(calloutPattern);

      if (match) {
        const calloutType = match[1].toLowerCase();

        // Remove the callout marker from the text
        const newText = textNode.value.replace(calloutPattern, '');

        if (newText.trim() === '') {
          // Remove the text node if it becomes empty
          firstChild.children.shift();
        } else {
          // Update the text content
          textNode.value = newText;
        }

        // Add the data attribute to the blockquote
        // This creates a custom property that will be preserved when converting to HTML
        if (!node.data) {
          node.data = {};
        }
        if (!(node.data as any).hProperties) {
          (node.data as any).hProperties = {};
        }
        (node.data as any).hProperties['data-callout-type'] = calloutType;
      }
    });
  };
};

export default transformMarkdownBlockquoteCallouts;
