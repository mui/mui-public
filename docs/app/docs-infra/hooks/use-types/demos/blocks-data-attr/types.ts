import { createMultipleTypes } from '../createTypes';
import { Component } from './Component';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, Component);

export const TypesComponent = types;
export const TypesComponentAdditional = AdditionalTypes;
