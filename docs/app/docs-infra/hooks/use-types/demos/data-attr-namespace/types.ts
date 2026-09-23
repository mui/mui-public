import { createTypes } from '../createTypes';
import { Component } from './parts';

export const TypesComponentDataAttrNamespace = createTypes(import.meta.url, Component);
