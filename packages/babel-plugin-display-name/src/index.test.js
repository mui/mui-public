import { transformSync } from '@babel/core';
import { describe, it, expect } from 'vitest';
import plugin from './index';

const transform = (code, pluginOptions) =>
  transformSync(code, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, pluginOptions]],
    presets: [['@babel/preset-react', { pure: false }]],
  }).code;

const transformWithAllowedCallees = (code) =>
  transform(code, {
    allowedCallees: {
      'react-fela': ['createComponent', 'createComponentWithProxy'],
    },
  });

describe('babelDisplayNamePlugin', () => {
  it('should add display name to function expression components', () => {
    expect(
      transform(`
      foo.bar = function() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = function () {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);

    expect(
      transform(`
      const Test = function() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = function () {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);
  });

  it('should add display name to named function expression components', () => {
    expect(
      transform(`
      foo.bar = function Foo() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = function Foo() {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);

    expect(
      transform(`
      const Test = function Foo() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = function Foo() {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);
  });

  it('should add display name to arrow function components', () => {
    expect(
      transform(`
      foo.bar = () => {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);

    expect(
      transform(`
      const Test = () => {
        return <img/>;
      };`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = () => {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      const Test = () => <img/>;`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      const Test = () => () => <img/>;`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = () => () => _jsx("img", {});"
    `);
  });

  it('should add display name to call expressions', () => {
    expect(
      transform(`
      import React from 'react'
      const Test = React.memo(() => {
        return <img/>;
      })`),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      import { jsx as _jsx } from "react/jsx-runtime";
      const Test = React.memo(() => {
        return _jsx("img", {});
      });
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      import React from 'react'
      const foo = {
        bar: React.memo(() => {
          return <img/>;
        })
      };`),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      import { jsx as _jsx } from "react/jsx-runtime";
      const foo = {
        bar: React.memo(() => {
          return _jsx("img", {});
        })
      };
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);

    expect(
      transform(`
      import React from 'react'
      const Test = React.memo(React.createRef((props, ref) => {
        return <img/>;
      }))`),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      import { jsx as _jsx } from "react/jsx-runtime";
      const Test = React.memo(React.createRef((props, ref) => {
        return _jsx("img", {});
      }));
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      import React from 'react'
      const Test = React.memo(function _Test(props, ref) {
        return <img/>;
      })`),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      import { jsx as _jsx } from "react/jsx-runtime";
      const Test = React.memo(function _Test(props, ref) {
        return _jsx("img", {});
      });
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      import React from 'react'
      export const Test = React.memo(() => {
        return <img/>;
      })`),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      import { jsx as _jsx } from "react/jsx-runtime";
      export const Test = React.memo(() => {
        return _jsx("img", {});
      });
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);
  });

  it('should add display name to allowed call expressions', () => {
    expect(
      transform(`
      import { createContext } from 'react';
      const FeatureContext = createContext();
      `),
    ).toMatchInlineSnapshot(`
      "import { createContext } from 'react';
      const FeatureContext = createContext();
      if (process.env.NODE_ENV !== "production") FeatureContext.displayName = "FeatureContext";"
    `);

    expect(
      transform(`
      import React from 'react';
      const FeatureContext = React.createContext();
      `),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      const FeatureContext = React.createContext();
      if (process.env.NODE_ENV !== "production") FeatureContext.displayName = "FeatureContext";"
    `);

    expect(
      transform(`
      import * as React from 'react';
      const FeatureContext = React.createContext();
      `),
    ).toMatchInlineSnapshot(`
      "import * as React from 'react';
      const FeatureContext = React.createContext();
      if (process.env.NODE_ENV !== "production") FeatureContext.displayName = "FeatureContext";"
    `);

    expect(
      transform(
        `
      import React from 'path/to/react';
      const FeatureContext = React.createContext();
      `,
        {
          allowedCallees: {
            'path/to/react': ['createContext'],
          },
        },
      ),
    ).toMatchInlineSnapshot(`
      "import React from 'path/to/react';
      const FeatureContext = React.createContext();
      if (process.env.NODE_ENV !== "production") FeatureContext.displayName = "FeatureContext";"
    `);

    expect(
      transformWithAllowedCallees(`
      import { createComponent, createComponentWithProxy } from 'react-fela';
      foo.bar = createComponent();
      foo.bar1 = createComponentWithProxy();
      `),
    ).toMatchInlineSnapshot(`
      "import { createComponent, createComponentWithProxy } from 'react-fela';
      foo.bar = createComponent();
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";
      foo.bar1 = createComponentWithProxy();
      if (process.env.NODE_ENV !== "production") foo.bar1.displayName = "foo.bar1";"
    `);

    expect(
      transformWithAllowedCallees(`
      import { createComponent } from 'react-fela';
      foo = { bar: createComponent() }
      `),
    ).toMatchInlineSnapshot(`
      "import { createComponent } from 'react-fela';
      foo = {
        bar: createComponent()
      };
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);

    expect(
      transformWithAllowedCallees(`
      import { createComponent } from 'react-fela';
      const Test = createComponent();
      `),
    ).toMatchInlineSnapshot(`
      "import { createComponent } from 'react-fela';
      const Test = createComponent();
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);
  });

  it('should add display name to object property components', () => {
    expect(
      transform(`
      const Components = {
        path: {
          test: () => <img/>
        }
      };`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = {
        path: {
          test: () => _jsx("img", {})
        }
      };
      if (process.env.NODE_ENV !== "production") Components.path.test.displayName = "Components.path.test";"
    `);

    expect(
      transform(`
      const pathStr = 'path';
      const Components = {
        [pathStr]: {
          test: () => <img/>
        }
      };`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const pathStr = 'path';
      const Components = {
        [pathStr]: {
          test: () => _jsx("img", {})
        }
      };
      if (process.env.NODE_ENV !== "production") Components[pathStr].test.displayName = "Components[pathStr].test";"
    `);

    expect(
      transform(`
      const Components = {
        test: function() { return <img/> }
      };`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = {
        test: function () {
          return _jsx("img", {});
        }
      };
      if (process.env.NODE_ENV !== "production") Components.test.displayName = "Components.test";"
    `);

    expect(
      transform(`
      const Components = {
        test: function Foo() { return <img/> }
      };`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = {
        test: function Foo() {
          return _jsx("img", {});
        }
      };
      if (process.env.NODE_ENV !== "production") Components.test.displayName = "Components.test";"
    `);
  });

  it('should add display name to object methods', () => {
    expect(
      transform(`
      const Components = {
        path: {
          test(props) {
            return <img/>;
          },
        }
      };
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = {
        path: {
          test(props) {
            return _jsx("img", {});
          }
        }
      };
      if (process.env.NODE_ENV !== "production") Components.path.test.displayName = "Components.path.test";"
    `);

    expect(
      transform(`
      const Components = {
        [foo[bar.foobar].baz]: {
          test(props) {
            return <img/>;
          },
        }
      };
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = {
        [foo[bar.foobar].baz]: {
          test(props) {
            return _jsx("img", {});
          }
        }
      };
      if (process.env.NODE_ENV !== "production") Components[foo[bar.foobar].baz].test.displayName = "Components[foo[bar.foobar].baz].test";"
    `);
  });

  it('should add display name to fragments', () => {
    expect(
      transform(`
      const Component = (props) => <><img {...props} /></>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
      const Component = props => _jsx(_Fragment, {
        children: _jsx("img", {
          ...props
        })
      });
      if (process.env.NODE_ENV !== "production") Component.displayName = "Component";"
    `);
  });

  it('should add display name to various expressions', () => {
    expect(
      transform(`
      const Component = () => false ? <img/> : null;
      const Component1 = () => <img/> || null;
      const Component2 = () => [<img/>];
      const Component3 = () => { return <img/> };

      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component = () => false ? _jsx("img", {}) : null;
      if (process.env.NODE_ENV !== "production") Component.displayName = "Component";
      const Component1 = () => _jsx("img", {}) || null;
      if (process.env.NODE_ENV !== "production") Component1.displayName = "Component1";
      const Component2 = () => [_jsx("img", {})];
      if (process.env.NODE_ENV !== "production") Component2.displayName = "Component2";
      const Component3 = () => {
        return _jsx("img", {});
      };
      if (process.env.NODE_ENV !== "production") Component3.displayName = "Component3";"
    `);
  });

  it('should add display name for various kinds of assignments', () => {
    expect(
      transform(`
      var Test = () => <img/>
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      var Test = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      let Test = () => <img/>
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      let Test = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);

    expect(
      transform(`
      export const Test = () => <img/>
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export const Test = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);
  });

  it('should not add display names for nameless functions', () => {
    expect(
      transformWithAllowedCallees(`
      export default () => <img/>
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export default () => _jsx("img", {});"
    `);

    expect(
      transformWithAllowedCallees(`
      const element = <Text render={() => <img />} />
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const element = _jsx(Text, {
        render: () => _jsx("img", {})
      });"
    `);

    expect(
      transformWithAllowedCallees(`
      (() => <img/>)()
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      (() => _jsx("img", {}))();"
    `);

    expect(
      transformWithAllowedCallees(`
      {() => <img/>}
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      {
        () => _jsx("img", {});
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      (function() { return <img/> })()
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      (function () {
        return _jsx("img", {});
      })();"
    `);

    expect(
      transformWithAllowedCallees(`
      (function test() { return <img/> })()
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      (function test() {
        return _jsx("img", {});
      })();"
    `);

    expect(
      transformWithAllowedCallees(`
      export default function() { return <img/> }
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export default function () {
        return _jsx("img", {});
      }"
    `);
  });

  it('should not move elements out of their current scope', () => {
    expect(
      transformWithAllowedCallees(`
      const Component = (props) => <>{() => <img {...props} />}</>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
      const Component = props => _jsx(_Fragment, {
        children: () => _jsx("img", {
          ...props
        })
      });
      if (process.env.NODE_ENV !== "production") Component.displayName = "Component";"
    `);

    expect(
      transformWithAllowedCallees(`
      styledComponents.withTheme = (Component) => {
        const WithDefaultTheme = (props) => {
          return <div {...props} />;
        }
        return WithDefaultTheme;
      };
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      styledComponents.withTheme = Component => {
        const WithDefaultTheme = props => {
          return _jsx("div", {
            ...props
          });
        };
        if (process.env.NODE_ENV !== "production") WithDefaultTheme.displayName = "WithDefaultTheme";
        return WithDefaultTheme;
      };"
    `);

    expect(
      transformWithAllowedCallees(`
      const Component = (options) => {
        return {
          test: function test(props) {
            return <img/>
          },
        };
      };
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component = options => {
        return {
          test: function test(props) {
            return _jsx("img", {});
          }
        };
      };"
    `);

    expect(
      transformWithAllowedCallees(`
      const Component = (props) => ({ test: <img {...props} /> });
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component = props => ({
        test: _jsx("img", {
          ...props
        })
      });"
    `);

    expect(
      transformWithAllowedCallees(`
      const Component = (props) => {
        const LookUp = ((innerProps) => ({ a: () => <img {...innerProps} /> }))(props);
        return <div>{() => LookUp.a}</div>
      };
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component = props => {
        const LookUp = (innerProps => ({
          a: () => _jsx("img", {
            ...innerProps
          })
        }))(props);
        return _jsx("div", {
          children: () => LookUp.a
        });
      };
      if (process.env.NODE_ENV !== "production") Component.displayName = "Component";"
    `);
  });

  it('should add not overwrite existing display names', () => {
    expect(
      transformWithAllowedCallees(`
      foo.bar = () => <img/>;
      foo.bar.displayName = 'test';
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => _jsx("img", {});
      foo.bar.displayName = 'test';"
    `);

    expect(
      transformWithAllowedCallees(`
      foo.bar = () => <img/>;
      foo.bar.displayName = 'test';
      foo.bar = () => <img/>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => _jsx("img", {});
      foo.bar.displayName = 'test';
      foo.bar = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);

    expect(
      transformWithAllowedCallees(`
      foo.bar = () => <img/>;
      foo.bar.displayName = 'foo.bar';
      foo.bar = () => <img/>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => _jsx("img", {});
      foo.bar.displayName = 'foo.bar';
      foo.bar = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";"
    `);
  });

  it('should not add duplicate display names', () => {
    expect(
      transformWithAllowedCallees(`
      () => {
        const Test = () => <img/>;
      }
      const Test = () => <img/>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      () => {
        const Test = () => _jsx("img", {});
        if (process.env.NODE_ENV !== "production") Test.displayName = "Test";
      };
      const Test = () => _jsx("img", {});"
    `);
  });

  it('should not change assignment orders', () => {
    expect(
      transformWithAllowedCallees(`
      foo.bar = () => <img/>;
      foo.bar = () => <br/>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";
      foo.bar = () => _jsx("br", {});"
    `);

    expect(
      transformWithAllowedCallees(`
      foo.bar = () => <img/>;
      delete foo.bar;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";
      delete foo.bar;"
    `);

    expect(
      transformWithAllowedCallees(`
      foo.bar = () => <img/>;
      function irrelvant() {};
      foo = null;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      foo.bar = () => _jsx("img", {});
      if (process.env.NODE_ENV !== "production") foo.bar.displayName = "foo.bar";
      function irrelvant() {}
      ;
      foo = null;"
    `);
  });

  it('should not add display name to object properties', () => {
    expect(
      transformWithAllowedCallees(`
      const Components = {
        path: {
          test: <img/>
        }
      };`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = {
        path: {
          test: _jsx("img", {})
        }
      };"
    `);

    expect(
      transformWithAllowedCallees(`
      const Components = () => ({
        path: {
          test: <img/>
        }
      });`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = () => ({
        path: {
          test: _jsx("img", {})
        }
      });"
    `);

    expect(
      transformWithAllowedCallees(`
      const Components = callee({ foo: () => <img/> });
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = callee({
        foo: () => _jsx("img", {})
      });"
    `);

    expect(
      transformWithAllowedCallees(`
      const Components = () => <div>{() => <img/>}</div>;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Components = () => _jsx("div", {
        children: () => _jsx("img", {})
      });
      if (process.env.NODE_ENV !== "production") Components.displayName = "Components";"
    `);
  });

  it('should not add display name to createClass', () => {
    expect(
      transformWithAllowedCallees(`
      const Component2 = _createClass(() => <img/>);
      `),
    ).toMatchInlineSnapshot(
      `
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component2 = _createClass(() => _jsx("img", {}));"
    `,
    );
  });

  it('should not add display name to hooks', () => {
    expect(
      transformWithAllowedCallees(`
      const Component = useMemo(() => <img/>);
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component = useMemo(() => _jsx("img", {}));"
    `);
  });

  it('should not add display name to class components', () => {
    expect(
      transformWithAllowedCallees(`
      class Test extends React.Component {
        render() {
          return <img/>;
        }
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      class Test extends React.Component {
        render() {
          return _jsx("img", {});
        }
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      class Test extends React.Component {
        notRender() {
          return <img/>;
        }
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      class Test extends React.Component {
        notRender() {
          return _jsx("img", {});
        }
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      export class Test extends React.Component {
        render() {
          return <img/>;
        }
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export class Test extends React.Component {
        render() {
          return _jsx("img", {});
        }
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      export default class Test extends React.Component {
        render() {
          return <img/>;
        }
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export default class Test extends React.Component {
        render() {
          return _jsx("img", {});
        }
      }"
    `);
  });

  it('should not add display name to function components', () => {
    expect(
      transformWithAllowedCallees(`
      function Test() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      function Test() {
        return _jsx("img", {});
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      export function Test() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export function Test() {
        return _jsx("img", {});
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      export default function Test() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export default function Test() {
        return _jsx("img", {});
      }"
    `);

    expect(
      transformWithAllowedCallees(`
      export default function() {
        return <img/>;
      }`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      export default function () {
        return _jsx("img", {});
      }"
    `);
  });

  it('should not add display name to unknown call expressions', () => {
    expect(
      transformWithAllowedCallees(`
      import { createDirectionalComponent } from 'react-fela';
      foo.bar = createDirectionalComponent();
      `),
    ).toMatchInlineSnapshot(`
      "import { createDirectionalComponent } from 'react-fela';
      foo.bar = createDirectionalComponent();"
    `);

    expect(
      transformWithAllowedCallees(`
      import fela from 'react-fela';
      foo.bar = fela.createDirectionalComponent();
      `),
    ).toMatchInlineSnapshot(`
      "import fela from 'react-fela';
      foo.bar = fela.createDirectionalComponent();"
    `);

    expect(
      transformWithAllowedCallees(`
      import * as fela from 'react-fela';
      foo.bar = fela.createDirectionalComponent();
      `),
    ).toMatchInlineSnapshot(`
      "import * as fela from 'react-fela';
      foo.bar = fela.createDirectionalComponent();"
    `);
  });

  it('should not add display name to immediately invoked function expressions', () => {
    expect(
      transformWithAllowedCallees(`
      const Test = (function () {
        return <img/>;
      })()`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = function () {
        return _jsx("img", {});
      }();"
    `);

    expect(
      transformWithAllowedCallees(`
      const Test = (function test() {
        return <img/>;
      })()`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = function test() {
        return _jsx("img", {});
      }();"
    `);

    expect(
      transformWithAllowedCallees(`
      const Test = (() => {
        return <img/>;
      })()`),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = (() => {
        return _jsx("img", {});
      })();"
    `);
  });

  it('should not add display name to functions within jsx elements', () => {
    expect(
      transformWithAllowedCallees(`
      const Test = callee(<div>{() => <img/>}</div>);
      `),
    ).toMatchInlineSnapshot(
      `
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = callee(_jsx("div", {
        children: () => _jsx("img", {})
      }));"
    `,
    );

    expect(
      transformWithAllowedCallees(`
      const Test = () => <img foo={{ bar: () => <img/> }} />;
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = () => _jsx("img", {
        foo: {
          bar: () => _jsx("img", {})
        }
      });
      if (process.env.NODE_ENV !== "production") Test.displayName = "Test";"
    `);
  });

  it('should not add display name to non react components', () => {
    expect(
      transformWithAllowedCallees(`
      // foo.bar = createComponent();
      const Component = '';
      const Component1 = null;
      const Component2 = undefined;
      const Component3 = 0;
      let Component4;
      var Component5;
      const Component6 = ['foo', 5, null, undefined];
      const Component7 = { foo: 'bar' };
      const Component8 = new Wrapper();
      const Component9 = () => {};
      `),
    ).toMatchInlineSnapshot(`
      "// foo.bar = createComponent();
      const Component = '';
      const Component1 = null;
      const Component2 = undefined;
      const Component3 = 0;
      let Component4;
      var Component5;
      const Component6 = ['foo', 5, null, undefined];
      const Component7 = {
        foo: 'bar'
      };
      const Component8 = new Wrapper();
      const Component9 = () => {};"
    `);
  });

  it('should not add display name to other assignments', () => {
    expect(
      transformWithAllowedCallees(`
      const Component = <img/>;
      const Component1 = [<img/>];
      const Component2 = new Wrapper(<img/>);
      const Component3 = async (props) => await <img/>;
      const Component4 = callee(<img/>);
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Component = _jsx("img", {});
      const Component1 = [_jsx("img", {})];
      const Component2 = new Wrapper(_jsx("img", {}));
      const Component3 = async props => await _jsx("img", {});
      const Component4 = callee(_jsx("img", {}));"
    `);
  });

  it('should handle things returning React.createElement and not direct JSX', () => {
    expect(
      transformWithAllowedCallees(`
        import React from 'react';

        const Foo = React.forwardRef(
          (props, ref) => {
            return React.createElement('div', {...props, ref})
          }
        )
    `),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      const Foo = React.forwardRef((props, ref) => {
        return React.createElement('div', {
          ...props,
          ref
        });
      });
      if (process.env.NODE_ENV !== "production") Foo.displayName = "Foo";"
    `);
  });

  it('should handle multiple wrappers', () => {
    expect(
      transformWithAllowedCallees(`
        import React from 'react';

        const Foo = React.memo(
          React.forwardRef(
            (props, ref) => {
              return React.createElement('div', {...props, ref})
            }
          )
        )
    `),
    ).toMatchInlineSnapshot(`
      "import React from 'react';
      const Foo = React.memo(React.forwardRef((props, ref) => {
        return React.createElement('div', {
          ...props,
          ref
        });
      }));
      if (process.env.NODE_ENV !== "production") Foo.displayName = "Foo";"
    `);
  });

  it(`shouldn't add display name to variables that are not functions`, () => {
    expect(
      transformWithAllowedCallees(`
      const Test = true ? () => <img/> : (undefined);
      `),
    ).toMatchInlineSnapshot(`
      "import { jsx as _jsx } from "react/jsx-runtime";
      const Test = true ? () => _jsx("img", {}) : undefined;"
    `);
  });
});
