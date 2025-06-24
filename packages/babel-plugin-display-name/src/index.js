// @ts-check

const { declare } = require('@babel/helper-plugin-utils');

/**
 * @typedef {import('@babel/core')} babel
 * @typedef {{ id: babel.types.Expression, computed?: boolean }} ComponentIdentifier
 */

// remember to set `cacheDirectory` to `false` when modifying this plugin

const DEFAULT_ALLOWED_CALLEES = {
  react: ['createContext', 'forwardRef', 'memo'],
};

/** @type {Map<string, string[]>} */
const calleeModuleMapping = new Map(); // Mapping of callee name to module name
const seenDisplayNames = new Set();

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
 * other functions that return JSX will still return `false`.
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
    } else if (t.isExpressionStatement(statement) && !t.isCallExpression(statement.expression)) {
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
      return isJSX(t, currentNode.consequent) || isJSX(t, currentNode.alternate);
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
  const callee = /** @type {babel.types.Expression} */ (path.node.callee);
  /** @type {string | undefined} */
  const calleeName = /** @type {any} */ (callee).name || /** @type {any} */ (callee).property?.name;
  const moduleNames = calleeName && calleeModuleMapping.get(calleeName);

  if (!moduleNames) {
    return false;
  }

  // If the callee is an identifier expression, then check if it matches
  // a named import, e.g. `import {createContext} from 'react'`.
  if (calleePath.isIdentifier()) {
    return moduleNames.some((moduleName) => calleePath.referencesImport(moduleName, calleeName));
  }

  // Otherwise, check if the member expression's object matches
  // a default import (e.g. `import React from 'react'`)
  // or namespace import (e.g. `import * as React from 'react')
  if (calleePath.isMemberExpression()) {
    const object = calleePath.get('object');

    return moduleNames.some(
      (moduleName) =>
        object.referencesImport(moduleName, 'default') || object.referencesImport(moduleName, '*'),
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
  if (/** @type {any} */ (path.node).key) {
    componentIdentifiers.push({ id: /** @type {any} */ (path.node).key });
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
      const callee = /** @types {babel.types.Expression} */ parentPath.node.callee;
      if (t.isArrowFunctionExpression(callee) || t.isFunctionExpression(callee)) {
        return true;
      }

      // Ignore instances where displayNames are disallowed
      // _createClass(() => <Element />)
      // useMemo(() => <Element />)
      const calleeName = t.isIdentifier(callee) ? callee.name : undefined;
      if (calleeName && (calleeName.startsWith('_') || calleeName.startsWith('use'))) {
        return true;
      }

      hasCallee = true;
    }

    // componentIdentifier = <Element />
    if (parentPath.isAssignmentExpression()) {
      assignmentPath = parentPath.parentPath;
      componentIdentifiers.unshift({
        id: /** @type {babel.types.Expression} */ (parentPath.node.left),
      });
      return true;
    }

    // const componentIdentifier = <Element />
    if (parentPath.isVariableDeclarator()) {
      // Ternary expression
      if (t.isConditionalExpression(parentPath.node.init)) {
        const { consequent, alternate } = parentPath.node.init;
        const isConsequentFunction =
          t.isArrowFunctionExpression(consequent) || t.isFunctionExpression(consequent);
        const isAlternateFunction =
          t.isArrowFunctionExpression(alternate) || t.isFunctionExpression(alternate);

        // Only add display name if variable is a function
        if (!isConsequentFunction || !isAlternateFunction) {
          return false;
        }
      }
      assignmentPath = parentPath.parentPath;
      componentIdentifiers.unshift({
        id: /** @type {babel.types.Expression} */ (parentPath.node.id),
      });
      return true;
    }

    // if this is not a continuous object key: value pair, stop processing it
    if (hasObjectProperty && !(parentPath.isObjectProperty() || parentPath.isObjectExpression())) {
      return true;
    }

    // { componentIdentifier: <Element /> }
    if (parentPath.isObjectProperty()) {
      hasObjectProperty = true;
      const node = parentPath.node;
      componentIdentifiers.unshift({
        id: /** @type {babel.types.Expression} */ (node.key),
        computed: node.computed,
      });
    }

    return false;
  });

  if (!assignmentPath || componentIdentifiers.length === 0) {
    return;
  }

  const name = generateDisplayName(t, componentIdentifiers);

  const pattern = `${name}.displayName`;

  // disallow duplicate names if they were assigned in different scopes
  if (seenDisplayNames.has(name) && !hasBeenAssignedPrev(t, assignmentPath, pattern, name)) {
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

  const displayNameStatement = createDisplayNameStatement(t, componentIdentifiers, name);

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
    displayName += componentIdentifier.computed ? `[${name}]` : `.${name}`;
  });

  return displayName.slice(1);
}

/**
 * Generate a displayName string based on the node.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.Node} node identifier or member expression node
 */
function generateNodeDisplayName(t, node) {
  if (t.isIdentifier(node)) {
    return node.name;
  }

  if (t.isMemberExpression(node)) {
    const objectDisplayName = generateNodeDisplayName(t, node.object);
    const propertyDisplayName = generateNodeDisplayName(t, node.property);

    const res = node.computed
      ? `${objectDisplayName}[${propertyDisplayName}]`
      : `${objectDisplayName}.${propertyDisplayName}`;
    return res;
  }

  return '';
}

/**
 * Checks if this path has been previously assigned to a particular value.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath} assignmentPath path where assignement will take place
 * @param {string} pattern assignment path in string form e.g. `x.y.z`
 * @param {string} value assignment value to compare with
 * @returns {boolean}
 */
function hasBeenAssignedPrev(t, assignmentPath, pattern, value) {
  return assignmentPath.getAllPrevSiblings().some((sibling) => {
    const expression = /** @type {babel.NodePath} */ (sibling.get('expression'));
    if (!t.isAssignmentExpression(expression.node, { operator: '=' })) {
      return false;
    }
    if (!t.isStringLiteral(expression.node.right, { value })) {
      return false;
    }
    return /** @type {babel.NodePath} */ (expression.get('left')).matchesPattern(pattern);
  });
}

/**
 * Checks if this path will be assigned later in the scope.
 *
 * @param {babel.types} t content of @babel/types package
 * @param {babel.NodePath} assignmentPath path where assignement will take place
 * @param {string} pattern assignment path in string form e.g. `x.y.z`
 * @returns {boolean}
 */
function hasBeenAssignedNext(t, assignmentPath, pattern) {
  return assignmentPath.getAllNextSiblings().some((sibling) => {
    const expression = /** @type {babel.NodePath} */ (sibling.get('expression'));
    if (!t.isAssignmentExpression(expression.node, { operator: '=' })) {
      return false;
    }
    return /** @type {babel.NodePath} */ (expression.get('left')).matchesPattern(pattern);
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
 * `name` will be changed to ensure that it is unique within the scope. e.g. `helper` -> `_helper`
 *
 * @param {babel.types} t content of @babel/types package
 * @param {string} name name of function to follow after
 */
function setInternalFunctionName(t, path, name) {
  if (!name || path.node.id != null || path.node.key != null) {
    return;
  }

  const id = path.scope.generateUidIdentifier(name);
  if (path.isArrowFunctionExpression()) {
    path.arrowFunctionToExpression();
  }
  path.node.id = id;
}
