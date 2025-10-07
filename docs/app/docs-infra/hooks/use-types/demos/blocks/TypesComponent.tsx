import { TypesComponentPart, TypesComponentRoot } from './types';

export const TypesComponent = () => {
  return (
    <div>
      <h3>ComponentRoot</h3>
      <TypesComponentRoot />
      <h3>ComponentPart</h3>
      <TypesComponentPart />
    </div>
  );
};
