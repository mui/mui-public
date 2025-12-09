import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { defaultHandlers } from 'hast-util-to-mdast';
import type { Handle } from 'hast-util-to-mdast';
import type { Element } from 'hast';

const NO_MARKDOWN = 'no-markdown';

function hasClassName(element: Element, className: string): boolean {
  const classNames = element.properties?.className;
  if (Array.isArray(classNames)) {
    return classNames.includes(className);
  }
  return classNames === className;
}

const div: Handle = (state, element) => {
  if (hasClassName(element, NO_MARKDOWN)) {
    return undefined;
  }

  return defaultHandlers.div(state, element);
};

const pre: Handle = (state, element) => {
  const output = defaultHandlers.pre(state, element);

  // TODO: dataFilename should be appended to the start of the code block

  if (typeof element.properties?.dataLang === 'string') {
    return { ...output, lang: element.properties.dataLang };
  }

  return output;
};

const a: Handle = (state, element) => {
  const output = defaultHandlers.a(state, element);

  if (output.url) {
    if (output.url.startsWith('/') && !output.url.endsWith('.md')) {
      // TODO: in some scenarios, we might want to include a hostname
      return { ...output, url: `${output.url}.md` };
    }
  }

  return output;
};

export async function transformHtmlToMarkdown(html: string): Promise<string> {
  const file = await unified()
    .use(rehypeParse)
    .use(rehypeSanitize, {
      attributes: { '*': ['className'], pre: ['dataLang', 'dataFilename'], a: ['href'] },
      strip: ['script', 'title'],
    })
    .use(rehypeRemark, { handlers: { div, pre, a } })
    .use(remarkGfm)
    .use(remarkStringify)
    .process(html);

  return String(file);
}
