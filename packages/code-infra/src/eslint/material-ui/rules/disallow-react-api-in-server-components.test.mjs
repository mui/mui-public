import eslint from 'eslint';
import parser from '@typescript-eslint/parser';
import rule from './disallow-react-api-in-server-components.mjs';

const ruleTester = new eslint.RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run('disallow-react-api-in-server-components', rule, {
  valid: [
    // Files with 'use client' directive are allowed to use React APIs
    {
      name: 'React.useState with use client directive',
      code: `'use client';
React.useState();`,
    },
    {
      name: 'React.useEffect with use client directive',
      code: `'use client';
React.useEffect(() => {});`,
    },
    {
      name: 'React.useContext with use client directive',
      code: `'use client';
React.useContext(MyContext);`,
    },
    {
      name: 'React.useRef with use client directive',
      code: `'use client';
React.useRef();`,
    },
    {
      name: 'import useState with use client directive',
      code: `'use client';
import { useState } from 'react';`,
    },
    {
      name: 'import useContext with use client directive',
      code: `'use client';
import { useContext } from 'react';`,
    },
    {
      name: 'import useRef with use client directive',
      code: `'use client';
import { useRef } from 'react';`,
    },
    {
      name: 'import useIsoLayoutEffect with use client directive',
      code: `'use client';
import { useIsoLayoutEffect } from '@mui/utils';`,
    },
    {
      name: 'useIsoLayoutEffect call with use client directive',
      code: `'use client';
useIsoLayoutEffect(() => {});`,
    },
    // APIs not in the forbidden list are allowed
    {
      name: 'React.memo is allowed',
      code: `React.memo(() => {});`,
    },
    {
      name: 'React.forwardRef is allowed',
      code: `React.forwardRef(() => {});`,
    },
    {
      name: 'import useMemo is allowed',
      code: `import { useMemo } from 'react';`,
    },
    {
      name: 'custom hook is allowed',
      code: `import { useCustomHook } from './hooks';`,
    },
    // ref prop with 'use client' directive is allowed
    {
      name: 'ref prop with use client directive',
      code: `'use client';
const Component = () => <input ref={myRef} />;`,
    },
    // non-ref props are allowed without 'use client' directive
    {
      name: 'non-ref props are allowed',
      code: `const Component = () => <input className="test" />;`,
    },
  ],
  invalid: [
    // React.* API calls without 'use client' directive
    {
      name: 'React.useState without use client directive',
      code: `React.useState();`,
      errors: [
        {
          message:
            "Using 'React.useState' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useState();`,
    },
    {
      name: 'React.useEffect without use client directive',
      code: `React.useEffect(() => {});`,
      errors: [
        {
          message:
            "Using 'React.useEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useEffect(() => {});`,
    },
    {
      name: 'React.useContext without use client directive',
      code: `React.useContext(MyContext);`,
      errors: [
        {
          message:
            "Using 'React.useContext' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useContext(MyContext);`,
    },
    {
      name: 'React.useRef without use client directive',
      code: `React.useRef();`,
      errors: [
        {
          message:
            "Using 'React.useRef' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useRef();`,
    },
    {
      name: 'React.useLayoutEffect without use client directive',
      code: `React.useLayoutEffect(() => {});`,
      errors: [
        {
          message:
            "Using 'React.useLayoutEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useLayoutEffect(() => {});`,
    },
    {
      name: 'React.useReducer without use client directive',
      code: `React.useReducer(reducer, initialState);`,
      errors: [
        {
          message:
            "Using 'React.useReducer' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useReducer(reducer, initialState);`,
    },
    {
      name: 'React.useTransition without use client directive',
      code: `React.useTransition();`,
      errors: [
        {
          message:
            "Using 'React.useTransition' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.useTransition();`,
    },
    {
      name: 'React.createContext without use client directive',
      code: `React.createContext();`,
      errors: [
        {
          message:
            "Using 'React.createContext' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
React.createContext();`,
    },
    // Named imports from 'react' without 'use client' directive
    {
      name: 'import useState without use client directive',
      code: `import { useState } from 'react';`,
      errors: [
        {
          message:
            "Using 'useState' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
import { useState } from 'react';`,
    },
    {
      name: 'import useContext without use client directive',
      code: `import { useContext } from 'react';`,
      errors: [
        {
          message:
            "Using 'useContext' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
import { useContext } from 'react';`,
    },
    {
      name: 'import useRef without use client directive',
      code: `import { useRef } from 'react';`,
      errors: [
        {
          message: "Using 'useRef' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
import { useRef } from 'react';`,
    },
    {
      name: 'import multiple React APIs without use client directive',
      code: `import { useState, useEffect } from 'react';`,
      errors: [
        {
          message:
            "Using 'useState' is forbidden if the file doesn't have a 'use client' directive.",
        },
        {
          message:
            "Using 'useEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
import { useState, useEffect } from 'react';`,
    },
    // Forbidden APIs (useIsoLayoutEffect)
    {
      name: 'import useIsoLayoutEffect without use client directive',
      code: `import { useIsoLayoutEffect } from '@mui/utils';`,
      errors: [
        {
          message:
            "Using 'useIsoLayoutEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
import { useIsoLayoutEffect } from '@mui/utils';`,
    },
    {
      name: 'import useIsoLayoutEffect as default without use client directive',
      code: `import useIsoLayoutEffect from '@mui/utils/useIsoLayoutEffect';`,
      errors: [
        {
          message:
            "Using 'useIsoLayoutEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
import useIsoLayoutEffect from '@mui/utils/useIsoLayoutEffect';`,
    },
    {
      name: 'useIsoLayoutEffect call without use client directive',
      code: `useIsoLayoutEffect(() => {});`,
      errors: [
        {
          message:
            "Using 'useIsoLayoutEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
useIsoLayoutEffect(() => {});`,
    },
    // No autofix for 'use server' files
    {
      name: 'React.useState in use server file (no autofix)',
      code: `'use server';
React.useState();`,
      errors: [
        {
          message:
            "Using 'React.useState' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: null,
    },
    {
      name: 'import useState in use server file (no autofix)',
      code: `'use server';
import { useState } from 'react';`,
      errors: [
        {
          message:
            "Using 'useState' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: null,
    },
    {
      name: 'import useIsoLayoutEffect in use server file (no autofix)',
      code: `'use server';
import { useIsoLayoutEffect } from '@mui/utils';`,
      errors: [
        {
          message:
            "Using 'useIsoLayoutEffect' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: null,
    },
    // ref prop without 'use client' directive
    {
      name: 'ref prop without use client directive',
      code: `const Component = () => <input ref={myRef} />;`,
      errors: [
        {
          message: "Using 'ref' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: `'use client';
const Component = () => <input ref={myRef} />;`,
    },
    {
      name: 'ref prop in use server file (no autofix)',
      code: `'use server';
const Component = () => <input ref={myRef} />;`,
      errors: [
        {
          message: "Using 'ref' is forbidden if the file doesn't have a 'use client' directive.",
        },
      ],
      output: null,
    },
  ],
});
