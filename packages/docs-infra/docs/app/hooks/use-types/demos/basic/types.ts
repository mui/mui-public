import { createTypes } from '../createTypes';
import Component from './Component'; // TODO: it should also work with external packages
// import { Checkbox } from '../../../../../components/Checkbox'; // TODO: more complex

export const TypesCheckbox = createTypes(import.meta.url, Component, {
  name: 'Checkbox',
}) as React.ComponentType;
// TODO: add passthrough generic for createDemo here
