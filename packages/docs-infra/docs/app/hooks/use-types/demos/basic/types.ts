import { createTypes } from '../createTypes';
import { MyComponent } from './Component'; // TODO: it should also work with external packages

export const TypesCheckbox = createTypes(import.meta.url, MyComponent) as React.ComponentType<{}>; // TODO: passthrough types in demos.
