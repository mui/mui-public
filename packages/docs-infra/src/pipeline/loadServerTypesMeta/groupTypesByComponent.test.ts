import { describe, it, expect } from 'vitest';
import { groupTypesByComponent } from './groupTypesByComponent';

const TYPE_SUFFIXES = ['Props', 'State'];

/** Group names mapped to the names of the types in them. */
function group(types: { name: string; type: string }[]) {
  return Object.fromEntries(
    Array.from(groupTypesByComponent(types, TYPE_SUFFIXES), ([groupName, groupTypes]) => [
      groupName,
      groupTypes.map((item) => item.name),
    ]),
  );
}

describe('groupTypesByComponent', () => {
  it('groups types under the sub-component they belong to', () => {
    expect(
      group([
        { name: 'Accordion.Root', type: 'component' },
        { name: 'Accordion.Root.State', type: 'raw' },
        { name: 'Accordion.Trigger', type: 'component' },
        { name: 'Accordion.Orientation', type: 'raw' },
        { name: 'DirectionProvider', type: 'component' },
      ]),
    ).toEqual({
      'Accordion.Root': ['Accordion.Root', 'Accordion.Root.State'],
      'Accordion.Trigger': ['Accordion.Trigger'],
      Default: ['Accordion.Orientation', 'DirectionProvider'],
    });
  });

  it('keeps everything in the default group without sub-components', () => {
    expect(
      group([
        { name: 'Button', type: 'component' },
        { name: 'Button.Props', type: 'raw' },
        { name: 'Button.State', type: 'raw' },
      ]),
    ).toEqual({ Default: ['Button', 'Button.Props', 'Button.State'] });
  });

  it('keeps the type helpers of a nested constant group with the group', () => {
    expect(
      group([
        { name: 'Toolbar.Button', type: 'component' },
        { name: 'Toolbar.ButtonDataAttributes', type: 'raw' },
        { name: 'Toolbar.ButtonDataAttributes.ButtonDataAttribute', type: 'raw' },
      ]),
    ).toEqual({
      'Toolbar.Button': ['Toolbar.Button'],
      Default: ['Toolbar.ButtonDataAttributes', 'Toolbar.ButtonDataAttributes.ButtonDataAttribute'],
    });
  });

  it('groups nested types under their first two parts when those name no type', () => {
    expect(
      group([
        { name: 'Toolbar.Button', type: 'component' },
        { name: 'Toolbar.Link.State', type: 'raw' },
      ]),
    ).toEqual({
      'Toolbar.Button': ['Toolbar.Button'],
      'Toolbar.Link': ['Toolbar.Link.State'],
    });
  });
});
