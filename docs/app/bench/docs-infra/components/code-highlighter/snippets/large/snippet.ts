const snippet: string = `// @ts-check

const { declare } = require('@babel/helper-plugin-utils');

/**
 * @typedef {import('@babel/core')} babel
 * @typedef {{ id: babel.types.Expression, computed?: boolean }} ComponentIdentifier
 */

// remember to set \`cacheDirectory\` to \`false\` when modifying this plugin

const DEFAULT_ALLOWED_CALLEES = {
  react: ['createContext', 'forwardRef', 'memo'],
};

/** @type {Map<string, string[]>} */
const calleeModuleMapping = new Map(); // Mapping of callee name to module name
const seenDisplayNames = new Set();

/**
 * Applies allowed callees mapping to the internal calleeModuleMapping.
 * @param {Record<string, string[]>} mapping - The mapping of module names to method names.
 */
function applyAllowedCallees(mapping) {
  Object.entries(mapping).forEach(([moduleName, methodNames]) => {
    methodNames.forEach((methodName) => {
      const moduleNames = calleeModuleMapping.get(methodName) ?? [];
      moduleNames.push(moduleName);
      calleeModuleMapping.set(methodName, moduleNames);
    });
  });
}

module.exports = declare((api, options) => {
  api.assertVersion(7);

  calleeModuleMapping.clear();

  applyAllowedCallees(DEFAULT_ALLOWED_CALLEES);

  if (options.allowedCallees) {
    applyAllowedCallees(options.allowedCallees);
  }

  const t = api.types;

  return {
    name: '@probablyup/babel-plugin-react-displayname',
    visitor: {
      Program() {
        // We allow duplicate names across files,
        // so we clear when we're transforming on a new file
        seenDisplayNames.clear();
      },
      'FunctionExpression|ArrowFunctionExpression|ObjectMethod': (
        /** @type {babel.NodePath<babel.types.FunctionExpression|babel.types.ArrowFunctionExpression|babel.types.ObjectMethod>} */ path,
      ) => {
        // if the parent is a call expression, make sure it's an allowed one
        if (
          path.parentPath && path.parentPath.isCallExpression()
            ? isAllowedCallExpression(t, path.parentPath)
            : true
        ) {
          if (doesReturnJSX(t, path.node.body)) {
            addDisplayNamesToFunctionComponent(t, path);
          }
        }
      },
      CallExpression(path) {
        if (isAllowedCallExpression(t, path)) {
          addDisplayNamesToFunctionComponent(t, path);
        }
      },
    },
  };
});

/**
 * Checks if this function returns JSX nodes.
 * It does not do type-checking, which means calling
 * other functions that return JSX will still return \`false\`.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.types.Statement | babel.types.Expression} node function node
 */
function doesReturnJSX(t, node) {
  if (!node) {
    return false;
  }

  const body = t.toBlock(node).body;
  if (!body) {
    return false;
  }

  return body.some((statement) => {
    /** @type {babel.Node | null | undefined} */
    let currentNode;

    if (t.isReturnStatement(statement)) {
      currentNode = statement.argument;
    } else if (
      t.isExpressionStatement(statement) &&
      !t.isCallExpression(statement.expression)
    ) {
      currentNode = statement.expression;
    } else {
      return false;
    }

    if (
      t.isCallExpression(currentNode) &&
      // detect *.createElement and count it as returning JSX
      // this could be improved a lot but will work for the 99% case
      t.isMemberExpression(currentNode.callee) &&
      t.isIdentifier(currentNode.callee.property) &&
      currentNode.callee.property.name === 'createElement'
    ) {
      return true;
    }

    if (t.isConditionalExpression(currentNode)) {
      return (
        isJSX(t, currentNode.consequent) || isJSX(t, currentNode.alternate)
      );
    }

    if (t.isLogicalExpression(currentNode)) {
      return isJSX(t, currentNode.left) || isJSX(t, currentNode.right);
    }

    if (t.isArrayExpression(currentNode)) {
      return currentNode.elements.some((ele) => isJSX(t, ele));
    }

    return isJSX(t, currentNode);
  });
}

/**
 * Checks if this node is JSXElement or JSXFragment,
 * which are the root nodes of react components.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.Node | null | undefined} node babel node
 */
function isJSX(t, node) {
  return t.isJSXElement(node) || t.isJSXFragment(node);
}

/**
 * Checks if this path is an allowed CallExpression.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath<babel.types.CallExpression>} path path of callee
 */
function isAllowedCallExpression(t, path) {
  const calleePath = path.get('callee');
  const callee = /** @type {babel.types.Expression} */ path.node.callee;
  /** @type {string | undefined} */
  const calleeName =
    /** @type {any} */ callee.name || /** @type {any} */ callee.property?.name;
  const moduleNames = calleeName && calleeModuleMapping.get(calleeName);

  if (!moduleNames) {
    return false;
  }

  // If the callee is an identifier expression, then check if it matches
  // a named import, e.g. \`import {createContext} from 'react'\`.
  if (calleePath.isIdentifier()) {
    return moduleNames.some((moduleName) =>
      calleePath.referencesImport(moduleName, calleeName),
    );
  }

  if (calleePath.isMemberExpression()) {
    const object = calleePath.get('object');

    return moduleNames.some(
      (moduleName) =>
        object.referencesImport(moduleName, 'default') ||
        object.referencesImport(moduleName, '*'),
    );
  }

  return false;
}

/**
 * Adds displayName to the function component if it is:
 *  - assigned to a variable or object path
 *  - not within other JSX elements
 *  - not called by a react hook or _createClass helper
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath<babel.types.FunctionExpression|babel.types.ArrowFunctionExpression|babel.types.ObjectMethod|babel.types.CallExpression>} path path of function
 */
function addDisplayNamesToFunctionComponent(t, path) {
  /** @type {ComponentIdentifier[]} */
  const componentIdentifiers = [];
  if (/** @type {any} */ path.node.key) {
    componentIdentifiers.push({ id: /** @type {any} */ path.node.key });
  }

  /** @type {babel.NodePath | undefined} */
  let assignmentPath;
  let hasCallee = false;
  let hasObjectProperty = false;

  const scopePath = path.scope.parent && path.scope.parent.path;
  path.find((parentPath) => {
    // we've hit the scope, stop going further up
    if (parentPath === scopePath) {
      return true;
    }

    // Ignore functions within jsx
    if (isJSX(t, parentPath.node)) {
      return true;
    }

    if (parentPath.isCallExpression()) {
      // Ignore immediately invoked function expressions (IIFEs)
      const callee =
        /** @types {babel.types.Expression} */ parentPath.node.callee;
      if (
        t.isArrowFunctionExpression(callee) ||
        t.isFunctionExpression(callee)
      ) {
        return true;
      }

      // Ignore instances where displayNames are disallowed
      // _createClass(() => <Element />)
      // useMemo(() => <Element />)
      const calleeName = t.isIdentifier(callee) ? callee.name : undefined;
      if (
        calleeName &&
        (calleeName.startsWith('_') || calleeName.startsWith('use'))
      ) {
        return true;
      }

      hasCallee = true;
    }

    // componentIdentifier = <Element />
    if (parentPath.isAssignmentExpression()) {
      assignmentPath = parentPath.parentPath;
      componentIdentifiers.unshift({
        id: /** @type {babel.types.Expression} */ parentPath.node.left,
      });
      return true;
    }

    // const componentIdentifier = <Element />
    if (parentPath.isVariableDeclarator()) {
      // Ternary expression
      if (t.isConditionalExpression(parentPath.node.init)) {
        const { consequent, alternate } = parentPath.node.init;
        const isConsequentFunction =
          t.isArrowFunctionExpression(consequent) ||
          t.isFunctionExpression(consequent);
        const isAlternateFunction =
          t.isArrowFunctionExpression(alternate) ||
          t.isFunctionExpression(alternate);

        // Only add display name if variable is a function
        if (!isConsequentFunction || !isAlternateFunction) {
          return false;
        }
      }
      assignmentPath = parentPath.parentPath;
      componentIdentifiers.unshift({
        id: /** @type {babel.types.Expression} */ parentPath.node.id,
      });
      return true;
    }

    // if this is not a continuous object key: value pair, stop processing it
    if (
      hasObjectProperty &&
      !(parentPath.isObjectProperty() || parentPath.isObjectExpression())
    ) {
      return true;
    }

    // { componentIdentifier: <Element /> }
    if (parentPath.isObjectProperty()) {
      hasObjectProperty = true;
      const node = parentPath.node;
      componentIdentifiers.unshift({
        id: /** @type {babel.types.Expression} */ node.key,
        computed: node.computed,
      });
    }

    return false;
  });

  if (!assignmentPath || componentIdentifiers.length === 0) {
    return;
  }

  const name = generateDisplayName(t, componentIdentifiers);

  const pattern = \`\${name}.displayName\`;

  // disallow duplicate names if they were assigned in different scopes
  if (
    seenDisplayNames.has(name) &&
    !hasBeenAssignedPrev(t, assignmentPath, pattern, name)
  ) {
    return;
  }

  // skip unnecessary addition of name if it is reassigned later on
  if (hasBeenAssignedNext(t, assignmentPath, pattern)) {
    return;
  }

  // at this point we're ready to start pushing code

  if (hasCallee) {
    // if we're getting called by some wrapper function,
    // give this function a name
    setInternalFunctionName(t, path, name);
  }

  const displayNameStatement = createDisplayNameStatement(
    t,
    componentIdentifiers,
    name,
  );

  assignmentPath.insertAfter(displayNameStatement);

  seenDisplayNames.add(name);
}

/**
 * Generate a displayName string based on the ids collected.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {ComponentIdentifier[]} componentIdentifiers list of { id, computed } objects
 */
function generateDisplayName(t, componentIdentifiers) {
  let displayName = '';
  componentIdentifiers.forEach((componentIdentifier) => {
    const node = componentIdentifier.id;
    if (!node) {
      return;
    }
    const name = generateNodeDisplayName(t, node);
    displayName += componentIdentifier.computed ? \`[\${name}]\` : \`.\${name}\`;
  });

  return displayName.slice(1);
}

/**
 * Generate a displayName string based on the node.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.Node} node identifier or member expression node
 * @returns {string}
 */
function generateNodeDisplayName(t, node) {
  if (t.isIdentifier(node)) {
    return node.name;
  }

  if (t.isMemberExpression(node)) {
    const objectDisplayName = generateNodeDisplayName(t, node.object);
    const propertyDisplayName = generateNodeDisplayName(t, node.property);

    const res = node.computed
      ? \`\${objectDisplayName}[\${propertyDisplayName}]\`
      : \`\${objectDisplayName}.\${propertyDisplayName}\`;
    return res;
  }

  return '';
}

/**
 * Checks if this path has been previously assigned to a particular value.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath} assignmentPath path where assignement will take place
 * @param {string} pattern assignment path in string form e.g. \`x.y.z\`
 * @param {string} value assignment value to compare with
 * @returns {boolean}
 */
function hasBeenAssignedPrev(t, assignmentPath, pattern, value) {
  return assignmentPath.getAllPrevSiblings().some((sibling) => {
    const expression = /** @type {babel.NodePath} */ sibling.get('expression');
    if (!t.isAssignmentExpression(expression.node, { operator: '=' })) {
      return false;
    }
    if (!t.isStringLiteral(expression.node.right, { value })) {
      return false;
    }
    return /** @type {babel.NodePath} */ expression
      .get('left')
      .matchesPattern(pattern);
  });
}

/**
 * Checks if this path will be assigned later in the scope.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath} assignmentPath path where assignement will take place
 * @param {string} pattern assignment path in string form e.g. \`x.y.z\`
 * @returns {boolean}
 */
function hasBeenAssignedNext(t, assignmentPath, pattern) {
  return assignmentPath.getAllNextSiblings().some((sibling) => {
    const expression = /** @type {babel.NodePath} */ sibling.get('expression');
    if (!t.isAssignmentExpression(expression.node, { operator: '=' })) {
      return false;
    }
    return /** @type {babel.NodePath} */ expression
      .get('left')
      .matchesPattern(pattern);
  });
}

/**
 * Generate a displayName ExpressionStatement node based on the ids.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {ComponentIdentifier[]} componentIdentifiers list of { id, computed } objects
 * @param {string} displayName name of the function component
 */
function createDisplayNameStatement(t, componentIdentifiers, displayName) {
  const node = createMemberExpression(t, componentIdentifiers);

  const expression = t.assignmentExpression(
    '=',
    t.memberExpression(node, t.identifier('displayName')),
    t.stringLiteral(displayName),
  );

  const ifStatement = t.ifStatement(
    t.binaryExpression(
      '!==',
      t.memberExpression(
        t.memberExpression(t.identifier('process'), t.identifier('env')),
        t.identifier('NODE_ENV'),
      ),
      t.stringLiteral('production'),
    ),
    t.expressionStatement(expression),
  );

  return ifStatement;
}

/**
 * Helper that creates a MemberExpression node from the ids.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {ComponentIdentifier[]} componentIdentifiers list of { id, computed } objects
 * @returns {babel.types.Expression}
 */
function createMemberExpression(t, componentIdentifiers) {
  let node = componentIdentifiers[0].id;
  if (componentIdentifiers.length > 1) {
    for (let i = 1; i < componentIdentifiers.length; i += 1) {
      const { id, computed } = componentIdentifiers[i];
      node = t.memberExpression(node, id, computed);
    }
  }
  return node;
}

/**
 * Changes the arrow function to a function expression and gives it a name.
 * \`name\` will be changed to ensure that it is unique within the scope. e.g. \`helper\` -> \`_helper\`
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath<babel.types.ArrowFunctionExpression | babel.types.CallExpression | babel.types.FunctionExpression | babel.types.ObjectMethod>} path path to the function node
 * @param {string} name name of function to follow after
 */
function setInternalFunctionName(t, path, name) {
  if (
    !name ||
    ('id' in path.node && path.node.id != null) ||
    ('key' in path.node && path.node.key != null)
  ) {
    return;
  }

  const id = path.scope.generateUidIdentifier(name);
  if (path.isArrowFunctionExpression()) {
    path.arrowFunctionToExpression();
  }
  // @ts-expect-error
  path.node.id = id;
}

const cssComponents = ['Box', 'Grid', 'Typography', 'Stack'];

/**
 * Produces markdown of the description that can be hosted anywhere.
 *
 * By default we assume that the markdown is hosted on mui.com which is
 * why the source includes relative url. We transform them to absolute urls with
 * this method.
 */
export async function computeApiDescription(
  api: { description: ComponentReactApi['description'] },
  options: { host: string },
): Promise<string> {
  const { host } = options;
  const file = await remark()
    .use(function docsLinksAttacher() {
      return function transformer(tree) {
        remarkVisit(tree, 'link', (linkNode) => {
          const link = linkNode as Link;
          if ((link.url as string).startsWith('/')) {
            link.url = \`\${host}\${link.url}\`;
          }
        });
      };
    })
    .process(api.description);

  return file.toString().trim();
}

/**
 * Add demos & API comment block to type definitions, e.g.:
 * /**
 *  * Demos:
 *  *
 *  * - [Icons](https://mui.com/components/icons/)
 *  * - [Material Icons](https://mui.com/components/material-icons/)
 *  *
 *  * API:
 *  *
 *  * - [Icon API](https://mui.com/api/icon/)
 */
async function annotateComponentDefinition(
  api: ComponentReactApi,
  componentJsdoc: Annotation,
  projectSettings: ProjectSettings,
) {
  const HOST = projectSettings.baseApiUrl ?? 'https://mui.com';

  const typesFilename = api.filename.replace(/.js$/, '.d.ts');
  const fileName = path.parse(api.filename).name;
  const typesSource = readFileSync(typesFilename, { encoding: 'utf8' });
  const typesAST = await babel.parseAsync(typesSource, {
    configFile: false,
    filename: typesFilename,
    presets: [require.resolve('@babel/preset-typescript')],
  });
  if (typesAST === null) {
    throw new Error('No AST returned from babel.');
  }

  let start = 0;
  let end = null;
  traverse(typesAST, {
    ExportDefaultDeclaration(babelPath) {
      /**
       * export default function Menu() {}
       */
      let node: babel.Node = babelPath.node;
      if (node.declaration.type === 'Identifier') {
        // declare const Menu: {};
        // export default Menu;
        if (babel.types.isIdentifier(babelPath.node.declaration)) {
          const bindingId = babelPath.node.declaration.name;
          const binding = babelPath.scope.bindings[bindingId];

          // The JSDoc MUST be located at the declaration
          if (babel.types.isFunctionDeclaration(binding.path.node)) {
            // For function declarations the binding is equal to the declaration
            // /**
            //  */
            // function Component() {}
            node = binding.path.node;
          } else {
            // For variable declarations the binding points to the declarator.
            // /**
            //  */
            // const Component = () => {}
            node = binding.path.parentPath!.node;
          }
        }
      }

      const { leadingComments } = node;
      const leadingCommentBlocks =
        leadingComments != null
          ? leadingComments.filter(({ type }) => type === 'CommentBlock')
          : null;
      const jsdocBlock =
        leadingCommentBlocks != null ? leadingCommentBlocks[0] : null;
      if (leadingCommentBlocks != null && leadingCommentBlocks.length > 1) {
        throw new Error(
          \`Should only have a single leading jsdoc block but got \${
            leadingCommentBlocks.length
          }:
\${leadingCommentBlocks
            .map(({ type, value }, index) => \`#\${index} (\${type}): \${value}\`)
            .join('
')}\`,
        );
      }
      if (jsdocBlock?.start != null && jsdocBlock?.end != null) {
        start = jsdocBlock.start;
        end = jsdocBlock.end;
      } else if (node.start != null) {
        start = node.start - 1;
        end = start;
      }
    },

    ExportNamedDeclaration(babelPath) {
      let node: babel.Node = babelPath.node;

      if (node.declaration == null) {
        // export { Menu };
        node.specifiers.forEach((specifier) => {
          if (
            specifier.type === 'ExportSpecifier' &&
            specifier.local.name === fileName
          ) {
            const binding = babelPath.scope.bindings[specifier.local.name];

            if (babel.types.isFunctionDeclaration(binding.path.node)) {
              // For function declarations the binding is equal to the declaration
              // /**
              //  */
              // function Component() {}
              node = binding.path.node;
            } else {
              // For variable declarations the binding points to the declarator.
              // /**
              //  */
              // const Component = () => {}
              node = binding.path.parentPath!.node;
            }
          }
        });
      } else if (babel.types.isFunctionDeclaration(node.declaration)) {
        // export function Menu() {}
        if (node.declaration.id?.name === fileName) {
          node = node.declaration;
        }
      } else {
        return;
      }

      const { leadingComments } = node;
      const leadingCommentBlocks =
        leadingComments != null
          ? leadingComments.filter(({ type }) => type === 'CommentBlock')
          : null;
      const jsdocBlock =
        leadingCommentBlocks != null ? leadingCommentBlocks[0] : null;
      if (leadingCommentBlocks != null && leadingCommentBlocks.length > 1) {
        throw new Error(
          \`Should only have a single leading jsdoc block but got \${
            leadingCommentBlocks.length
          }:
\${leadingCommentBlocks
            .map(({ type, value }, index) => \`#\${index} (\${type}): \${value}\`)
            .join('
')}\`,
        );
      }
      if (jsdocBlock?.start != null && jsdocBlock?.end != null) {
        start = jsdocBlock.start;
        end = jsdocBlock.end;
      } else if (node.start != null) {
        start = node.start - 1;
        end = start;
      }
    },
  });

  if (end === null || start === 0) {
    throw new TypeError(
      \`\${api.filename}: Don't know where to insert the jsdoc block. Probably no default export or named export matching the file name was found.\`,
    );
  }

  let inheritanceAPILink = null;
  if (api.inheritance) {
    inheritanceAPILink = \`[\${api.inheritance.name} API](\${
      api.inheritance.apiPathname.startsWith('http')
        ? api.inheritance.apiPathname
        : \`\${HOST}\${api.inheritance.apiPathname}\`
    })\`;
  }

  const markdownLines = (
    await computeApiDescription(api, { host: HOST })
  ).split('
');
  // Ensure a newline between manual and generated description.
  if (markdownLines[markdownLines.length - 1] !== '') {
    markdownLines.push('');
  }

  if (api.customAnnotation) {
    markdownLines.push(
      ...api.customAnnotation
        .split('
')
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } else {
    markdownLines.push(
      'Demos:',
      '',
      ...api.demos.map((demo) => {
        return \`- [\${demo.demoPageTitle}](\${
          demo.demoPathname.startsWith('http')
            ? demo.demoPathname
            : \`\${HOST}\${demo.demoPathname}\`
        })\`;
      }),
      '',
    );

    markdownLines.push(
      'API:',
      '',
      \`- [\${api.name} API](\${
        api.apiPathname.startsWith('http')
          ? api.apiPathname
          : \`\${HOST}\${api.apiPathname}\`
      })\`,
    );
    if (api.inheritance) {
      markdownLines.push(\`- inherits \${inheritanceAPILink}\`);
    }
  }

  if (componentJsdoc.tags.length > 0) {
    markdownLines.push('');
  }

  componentJsdoc.tags.forEach((tag) => {
    markdownLines.push(
      \`@\${tag.title}\${tag.name ? \` \${tag.name} -\` : ''} \${tag.description}\`,
    );
  });

  const jsdoc = \`/**
\${markdownLines
    .map((line) => (line.length > 0 ? \` * \${line}\` : \` *\`))
    .join('
')}
 */\`;
  const typesSourceNew =
    typesSource.slice(0, start) + jsdoc + typesSource.slice(end);
  writeFileSync(typesFilename, typesSourceNew, { encoding: 'utf8' });
}

/**
 * Substitute CSS class description conditions with placeholder
 */
function extractClassCondition(description: string) {
  const stylesRegex =
    /((Styles|State class|Class name) applied to )(.*?)(( if | unless | when |, ){1}(.*))?./;

  const conditions = description.match(stylesRegex);

  if (conditions && conditions[6]) {
    return {
      description: renderMarkdown(
        description.replace(stylesRegex, '$1{{nodeName}}$5{{conditions}}.'),
      ),
      nodeName: renderMarkdown(conditions[3]),
      conditions: renderMarkdown(renderCodeTags(conditions[6])),
    };
  }

  if (conditions && conditions[3] && conditions[3] !== 'the root element') {
    return {
      description: renderMarkdown(
        description.replace(stylesRegex, '$1{{nodeName}}$5.'),
      ),
      nodeName: renderMarkdown(conditions[3]),
    };
  }

  return { description: renderMarkdown(description) };
}

const generateApiPage = async (
  apiPagesDirectory: string,
  importTranslationPagesDirectory: string,
  reactApi: ComponentReactApi,
  sortingStrategies?: SortingStrategiesType,
  onlyJsonFile: boolean = false,
  layoutConfigPath: string = '',
) => {
  const normalizedApiPathname = reactApi.apiPathname.replace(/\\/g, '/');
  /**
   * Gather the metadata needed for the component's API page.
   */
  const pageContent: ComponentApiContent = {
    // Sorted by required DESC, name ASC
    props: _.fromPairs(
      Object.entries(reactApi.propsTable).sort(
        ([aName, aData], [bName, bData]) => {
          if (
            (aData.required && bData.required) ||
            (!aData.required && !bData.required)
          ) {
            return aName.localeCompare(bName);
          }
          if (aData.required) {
            return -1;
          }
          return 1;
        },
      ),
    ),
    name: reactApi.name,
    imports: reactApi.imports,
    ...(reactApi.slots?.length > 0 && { slots: reactApi.slots }),
    ...(Object.keys(reactApi.cssVariables).length > 0 && {
      cssVariables: reactApi.cssVariables,
    }),
    ...(Object.keys(reactApi.dataAttributes).length > 0 && {
      dataAttributes: reactApi.dataAttributes,
    }),
    classes: reactApi.classes,
    spread: reactApi.spread,
    themeDefaultProps: reactApi.themeDefaultProps,
    muiName: normalizedApiPathname.startsWith('/joy-ui')
      ? reactApi.muiName.replace('Mui', 'Joy')
      : reactApi.muiName,
    forwardsRefTo: reactApi.forwardsRefTo,
    filename: toGitHubPath(reactApi.filename),
    inheritance: reactApi.inheritance
      ? {
          component: reactApi.inheritance.name,
          pathname: reactApi.inheritance.apiPathname,
        }
      : null,
    demos: \`<ul>\${reactApi.demos
      .map(
        (item) =>
          \`<li><a href="\${item.demoPathname}">\${item.demoPageTitle}</a></li>\`,
      )
      .join('
')}</ul>\`,
    cssComponent: cssComponents.includes(reactApi.name),
    deprecated: reactApi.deprecated,
  };

  const { classesSort = sortAlphabetical('key'), slotsSort = null } = {
    ...sortingStrategies,
  };

  if (classesSort) {
    pageContent.classes = [...pageContent.classes].sort(classesSort);
  }
  if (slotsSort && pageContent.slots) {
    pageContent.slots = [...pageContent.slots].sort(slotsSort);
  }

  await writePrettifiedFile(
    path.resolve(apiPagesDirectory, \`\${kebabCase(reactApi.name)}.json\`),
    JSON.stringify(pageContent),
  );


  export default function Page(props) {
    const { descriptions, pageContent } = props;
    return <ApiPage \${layoutConfigPath === '' ? '' : '{...layoutConfig} '}descriptions={descriptions} pageContent={pageContent} />;
  }

  Page.getInitialProps = () => {
    const req = require.context(
      '\${importTranslationPagesDirectory}/\${kebabCase(reactApi.name)}',
      false,
      /\\.\\/\${kebabCase(reactApi.name)}.*.json$/,
    );
    const descriptions = mapApiPageTranslations(req);

    return {
      descriptions,
      pageContent: jsonPageContent,
    };
  };
  \`.replace(/
?
/g, reactApi.EOL),
    );
  }
};

const attachTranslations = (
  reactApi: ComponentReactApi,
  deprecationInfo: string | undefined,
  settings?: CreateDescribeablePropSettings,
) => {
  const translations: ComponentReactApi['translations'] = {
    componentDescription: reactApi.description,
    deprecationInfo: deprecationInfo
      ? renderMarkdown(deprecationInfo)
      : undefined,
    propDescriptions: {},
    classDescriptions: {},
  };
  Object.entries(reactApi.props!).forEach(([propName, propDescriptor]) => {
    let prop: DescribeablePropDescriptor | null;
    try {
      prop = createDescribeableProp(propDescriptor, propName, settings);
    } catch (error) {
      prop = null;
    }
    if (prop) {
      const {
        deprecated,
        seeMore,
        jsDocText,
        signatureArgs,
        signatureReturn,
        requiresRef,
      } = generatePropDescription(prop, propName);
      // description = renderMarkdownInline(\`\${description}\`);

      const typeDescriptions: TypeDescriptions = {};
      (signatureArgs || [])
        .concat(signatureReturn || [])
        .forEach(({ name, description, argType, argTypeDescription }) => {
          typeDescriptions[name] = {
            name,
            description: renderMarkdown(description),
            argType,
            argTypeDescription: argTypeDescription
              ? renderMarkdown(argTypeDescription)
              : undefined,
          };
        });

      translations.propDescriptions[propName] = {
        description: renderMarkdown(jsDocText),
        requiresRef: requiresRef || undefined,
        deprecated: renderMarkdown(deprecated) || undefined,
        typeDescriptions:
          Object.keys(typeDescriptions).length > 0
            ? typeDescriptions
            : undefined,
        seeMoreText: seeMore?.description,
      };
    }
  });

  /**
   * Slot descriptions.
   */
  if (reactApi.slots?.length > 0) {
    translations.slotDescriptions = {};
    [...reactApi.slots]
      .sort(sortAlphabetical('name')) // Sort to ensure consistency of object key order
      .forEach((slot: Slot) => {
        const { name, description } = slot;
        translations.slotDescriptions![name] = renderMarkdown(description);
      });
  }

  /**
   * CSS class descriptions and deprecations.
   */
  [...reactApi.classes]
    .sort(sortAlphabetical('key')) // Sort to ensure consistency of object key order
    .forEach((classDefinition) => {
      translations.classDescriptions[classDefinition.key] = {
        ...extractClassCondition(classDefinition.description),
        deprecationInfo: classDefinition.deprecationInfo,
      };
    });
  reactApi.classes.forEach((classDefinition, index) => {
    delete reactApi.classes[index].deprecationInfo; // store deprecation info in translations only
  });

  /**
   * CSS variables descriptions.
   */
  if (Object.keys(reactApi.cssVariables).length > 0) {
    translations.cssVariablesDescriptions = {};
    [...Object.keys(reactApi.cssVariables)]
      .sort() // Sort to ensure consistency of object key order
      .forEach((cssVariableName: string) => {
        const cssVariable = reactApi.cssVariables[cssVariableName];
        const { description } = cssVariable;
        translations.cssVariablesDescriptions![cssVariableName] =
          renderMarkdown(description);
      });
  }

  /**
   * Data attributes descriptions.
   */
  if (Object.keys(reactApi.dataAttributes).length > 0) {
    translations.dataAttributesDescriptions = {};
    [...Object.keys(reactApi.dataAttributes)]
      .sort() // Sort to ensure consistency of object key order
      .forEach((dataAttributeName: string) => {
        const dataAttribute = reactApi.dataAttributes[dataAttributeName];
        const { description } = dataAttribute;
        translations.dataAttributesDescriptions![dataAttributeName] =
          renderMarkdown(description);
      });
  }

  reactApi.translations = translations;
};

const attachPropsTable = (
  reactApi: ComponentReactApi,
  settings?: CreateDescribeablePropSettings,
) => {
  const propErrors: Array<[propName: string, error: Error]> = [];
  type Pair = [string, ComponentReactApi['propsTable'][string]];
  const componentProps: ComponentReactApi['propsTable'] = _.fromPairs(
    Object.entries(reactApi.props!).map(([propName, propDescriptor]): Pair => {
      let prop: DescribeablePropDescriptor | null;
      try {
        prop = createDescribeableProp(propDescriptor, propName, settings);
      } catch (error) {
        propErrors.push([\`[\${reactApi.name}] \\\`\${propName}\\\`\`, error as Error]);
        prop = null;
      }
      if (prop === null) {
        // have to delete \`componentProps.undefined\` later
        return [] as any;
      }

      const defaultValue = propDescriptor.jsdocDefaultValue?.value;

      const {
        signature: signatureType,
        signatureArgs,
        signatureReturn,
        seeMore,
      } = generatePropDescription(prop, propName);
      const propTypeDescription = generatePropTypeDescription(
        propDescriptor.type,
      );
      const chainedPropType = getChained(prop.type);

      const requiredProp =
        prop.required ||
        prop.type.raw?.includes('.isRequired') ||
        (chainedPropType !== false && chainedPropType.required);

      const deprecation = (propDescriptor.description || '').match(
        /@deprecated(s+(?<info>.*))?/,
      );

      const additionalPropsInfo: AdditionalPropsInfo = {};

      const normalizedApiPathname = reactApi.apiPathname.replace(/\\/g, '/');

      if (propName === 'classes') {
        additionalPropsInfo.cssApi = true;
      } else if (propName === 'sx') {
        additionalPropsInfo.sx = true;
      } else if (
        propName === 'slots' &&
        !normalizedApiPathname.startsWith('/material-ui')
      ) {
        additionalPropsInfo.slotsApi = true;
      } else if (normalizedApiPathname.startsWith('/joy-ui')) {
        switch (propName) {
          case 'size':
            additionalPropsInfo['joy-size'] = true;
            break;
          case 'color':
            additionalPropsInfo['joy-color'] = true;
            break;
          case 'variant':
            additionalPropsInfo['joy-variant'] = true;
            break;
          default:
        }
      }

      let signature: ComponentReactApi['propsTable'][string]['signature'];
      if (signatureType !== undefined) {
        signature = {
          type: signatureType,
          describedArgs: signatureArgs?.map((arg) => arg.name),
          returned: signatureReturn?.name,
        };
      }
      return [
        propName,
        {
          type: {
            name: propDescriptor.type.name,
            description:
              propTypeDescription !== propDescriptor.type.name
                ? propTypeDescription
                : undefined,
          },
          default: defaultValue,
          // undefined values are not serialized => saving some bytes
          required: requiredProp || undefined,
          deprecated: !!deprecation || undefined,
          deprecationInfo:
            renderMarkdown(deprecation?.groups?.info || '').trim() || undefined,
          signature,
          additionalInfo:
            Object.keys(additionalPropsInfo).length === 0
              ? undefined
              : additionalPropsInfo,
          seeMoreLink: seeMore?.link,
        },
      ];
    }),
  );
  if (propErrors.length > 0) {
    throw new Error(
      \`There were errors creating prop descriptions:
\${propErrors
        .map(([propName, error]) => {
          return \`  - \${propName}: \${error}\`;
        })
        .join('
')}\`,
    );
  }

  // created by returning the \`[]\` entry
  delete componentProps.undefined;

  reactApi.propsTable = componentProps;
};

/**
 * Helper to get the import options
 * @param name The name of the component
 * @param filename The filename where its defined (to infer the package)
 * @returns an array of import command
 */
const defaultGetComponentImports = (name: string, filename: string) => {
  const githubPath = toGitHubPath(filename);
  const rootImportPath = githubPath.replace(
    //packages/mui(?:-(.+?))?/src/.*/,
    (match, pkg) => \`@mui/\${pkg}\`,
  );

  const subdirectoryImportPath = githubPath.replace(
    //packages/mui(?:-(.+?))?/src/([^\\/]+)/.*/,
    (match, pkg, directory) => \`@mui/\${pkg}/\${directory}\`,
  );

  let namedImportName = name;
  const defaultImportName = name;

  if (githubPath.includes('Unstable_')) {
    namedImportName = \`Unstable_\${name} as \${name}\`;
  }

  const useNamedImports = rootImportPath === '@mui/base';


  return [subpathImport, rootImport];
};

const attachTable = (
  reactApi: ComponentReactApi,
  params: ParsedProperty[],
  attribute: 'cssVariables' | 'dataAttributes',
  defaultType?: string,
) => {
  const errors: Array<[propName: string, error: Error]> = [];
  const data: { [key: string]: ApiItemDescription } = params
    .map((p) => {
      const { name: propName, ...propDescriptor } = p;
      let prop: Omit<ParsedProperty, 'name'> | null;
      try {
        prop = propDescriptor;
      } catch (error) {
        errors.push([propName, error as Error]);
        prop = null;
      }
      if (prop === null) {
        // have to delete \`componentProps.undefined\` later
        return [] as any;
      }

      const deprecationTag = propDescriptor.tags?.deprecated;
      const deprecation = deprecationTag?.text?.[0]?.text;

      const typeTag = propDescriptor.tags?.type;

      let type = typeTag?.text?.[0]?.text ?? defaultType;
      if (typeof type === 'string') {
        type = type.replace(/{|}/g, '');
      }

      return {
        name: propName,
        description: propDescriptor.description,
        type,
        deprecated: !!deprecation || undefined,
        deprecationInfo: renderMarkdown(deprecation || '').trim() || undefined,
      };
    })
    .reduce((acc, cssVarDefinition) => {
      const { name, ...rest } = cssVarDefinition;
      return {
        ...acc,
        [name]: rest,
      };
    }, {});

  if (errors.length > 0) {
    throw new Error(
      \`There were errors creating \${attribute.replace(/([A-Z])/g, ' $1')} descriptions:
\${errors
        .map(([item, error]) => {
          return \`  - \${item}: \${error}\`;
        })
        .join('
')}\`,
    );
  }

  reactApi[attribute] = data;
};

/**
 * - Build react component (specified filename) api by lookup at its definition (.d.ts or ts)
 *   and then generate the API page + json data
 * - Generate the translations
 * - Add the comment in the component filename with its demo & API urls (including the inherited component).
 *   this process is done by sourcing markdown files and filter matched \`components\` in the frontmatter
 */
export default async function generateComponentApi(
  componentInfo: ComponentInfo,
  project: TypeScriptProject,
  projectSettings: ProjectSettings,
) {
  const { shouldSkip, spread, EOL, src } = componentInfo.readFile();

  if (shouldSkip) {
    return null;
  }

  const filename = componentInfo.filename;
  let reactApi: ComponentReactApi;

  try {
    reactApi = docgenParse(
      src,
      null,
      defaultHandlers.concat(muiDefaultPropsHandler),
      {
        filename,
      },
    );
  } catch (error) {
    // fallback to default logic if there is no \`create*\` definition.
    if (
      (error as Error).message === 'No suitable component definition found.'
    ) {
      reactApi = docgenParse(
        src,
        (ast) => {
          let node;
          // TODO migrate to react-docgen v6, using Babel AST now
          astTypes.visit(ast, {
            visitFunctionDeclaration: (functionPath) => {
              // @ts-ignore
              if (functionPath.node.params[0].name === 'props') {
                node = functionPath;
              }
              return false;
            },
            visitVariableDeclaration: (variablePath) => {
              const definitions: any[] = [];
              if (variablePath.node.declarations) {
                variablePath
                  .get('declarations')
                  .each((declarator: any) =>
                    definitions.push(declarator.get('init')),
                  );
              }
              definitions.forEach((definition) => {
                // definition.value.expression is defined when the source is in TypeScript.
                const expression = definition.value?.expression
                  ? definition.get('expression')
                  : definition;
                if (expression.value?.callee) {
                  const definitionName = expression.value.callee.name;
                  if (definitionName === \`create\${componentInfo.name}\`) {
                    node = expression;
                  }
                }
              });
              return false;
            },
          });

          return node;
        },
        defaultHandlers.concat(muiDefaultPropsHandler),
        {
          filename,
        },
      );
    } else {
      throw error;
    }
  }

  if (!reactApi.props) {
    reactApi.props = {};
  }

  const { getComponentImports = defaultGetComponentImports } = projectSettings;
  const componentJsdoc = parseDoctrine(reactApi.description);

  // We override \`reactApi.description\` with \`componentJsdoc.description\` because
  // the former can include JSDoc tags that we don't want to render in the docs.
  reactApi.description = componentJsdoc.description;

  // Ignore what we might have generated in \`annotateComponentDefinition\`
  let annotationBoundary: RegExp = /(Demos|API):
?

?
/;
  if (componentInfo.customAnnotation) {
    annotationBoundary = new RegExp(
      escapeRegExp(componentInfo.customAnnotation.trim().split('
')[0].trim()),
    );
  }
  const annotatedDescriptionMatch = reactApi.description.match(
    new RegExp(annotationBoundary),
  );
  if (annotatedDescriptionMatch !== null) {
    reactApi.description = reactApi.description
      .slice(0, annotatedDescriptionMatch.index)
      .trim();
  }

  reactApi.filename = filename;
  reactApi.name = componentInfo.name;
  reactApi.imports = getComponentImports(componentInfo.name, filename);
  reactApi.muiName = componentInfo.muiName;
  reactApi.apiPathname = componentInfo.apiPathname;
  reactApi.EOL = EOL;
  reactApi.slots = [];
  reactApi.classes = [];
  reactApi.demos = componentInfo.getDemos();
  reactApi.customAnnotation = componentInfo.customAnnotation;
  reactApi.inheritance = null;
  if (reactApi.demos.length === 0) {
    throw new Error(
      'Unable to find demos. 
' +
        \`Be sure to include \\\`components: \${reactApi.name}\\\` in the markdown pages where the \\\`\${reactApi.name}\\\` component is relevant. \` +
        'Every public component should have a demo.
For internal component, add the name of the component to the \`skipComponent\` method of the product.',
    );
  }

  try {
    const testInfo = await parseTest(reactApi.filename);
    // no Object.assign to visually check for collisions
    reactApi.forwardsRefTo = testInfo.forwardsRefTo;
    reactApi.spread = testInfo.spread ?? spread;
    reactApi.themeDefaultProps = testInfo.themeDefaultProps;
    reactApi.inheritance = componentInfo.getInheritance(
      testInfo.inheritComponent,
    );
  } catch (error: any) {
    console.error(error.message);
    if (project.name.includes('grid')) {
      // TODO: Use \`describeConformance\` for the DataGrid components
      reactApi.forwardsRefTo = 'GridRoot';
    }
  }

  if (!projectSettings.skipSlotsAndClasses) {
    const { slots, classes } = parseSlotsAndClasses({
      typescriptProject: project,
      projectSettings,
      componentName: reactApi.name,
      muiName: reactApi.muiName,
      slotInterfaceName: componentInfo.slotInterfaceName,
    });

    reactApi.slots = slots;
    reactApi.classes = classes;
  }

  const deprecation = componentJsdoc.tags.find(
    (tag) => tag.title === 'deprecated',
  );
  const deprecationInfo = deprecation?.description || undefined;

  reactApi.deprecated = !!deprecation || undefined;

  const cssVars = await extractInfoFromEnum(
    \`\${componentInfo.name}CssVars\`,
    new RegExp(\`\${componentInfo.name}(CssVars|Classes)?.tsx?$\`, 'i'),
    project,
  );

  const dataAttributes = await extractInfoFromEnum(
    \`\${componentInfo.name}DataAttributes\`,
    new RegExp(\`\${componentInfo.name}(DataAttributes)?.tsx?$\`, 'i'),
    project,
  );

  attachPropsTable(reactApi, projectSettings.propsSettings);
  attachTable(reactApi, cssVars, 'cssVariables', 'string');
  attachTable(reactApi, dataAttributes, 'dataAttributes');
  attachTranslations(reactApi, deprecationInfo, projectSettings.propsSettings);

  // eslint-disable-next-line no-console
  console.log('Built API docs for', reactApi.apiPathname);

  if (!componentInfo.skipApiGeneration) {
    const {
      skipAnnotatingComponentDefinition,
      translationPagesDirectory,
      importTranslationPagesDirectory,
      generateJsonFileOnly,
    } = projectSettings;

    await generateApiTranslations(
      path.join(process.cwd(), translationPagesDirectory),
      reactApi,
      projectSettings.translationLanguages,
    );

    // Once we have the tabs API in all projects, we can make this default
    await generateApiPage(
      componentInfo.apiPagesDirectory,
      importTranslationPagesDirectory ?? translationPagesDirectory,
      reactApi,
      projectSettings.sortingStrategies,
      generateJsonFileOnly,
      componentInfo.layoutConfigPath,
    );

    if (
      typeof skipAnnotatingComponentDefinition === 'function'
        ? !skipAnnotatingComponentDefinition(reactApi.filename)
        : !skipAnnotatingComponentDefinition
    ) {
      // Add comment about demo & api links (including inherited component) to the component file
      await annotateComponentDefinition(
        reactApi,
        componentJsdoc,
        projectSettings,
      );
    }
  }

  return reactApi;
}
`;

// TODO: it would be better to get a large example that passes our linting
// that way we can save the contents as a `.ts` file and let the builder load it
export default snippet;
