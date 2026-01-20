import { createMultipleTypes } from '../createTypes';
import { Component } from './Component';

const { types } = createMultipleTypes(import.meta.url, Component);

export const TypesComponentRoot = types.Root;
export const TypesComponentPart = types.Part;
