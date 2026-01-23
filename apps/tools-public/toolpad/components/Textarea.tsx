import * as React from 'react';
import { createComponent } from '@toolpad/studio/browser';

export interface TextareaProps {
  value?: string;
  onValueChange: (value: string) => {};
}

function Textarea(props: TextareaProps) {
  return (
    <textarea
      style={{ width: '100%', height: 250 }}
      value={props.value}
      onChange={(event) => {
        props.onValueChange(event.target.value);
      }}
    />
  );
}

export default createComponent(Textarea, {
  argTypes: {
    value: {
      type: 'string',
      default: '',
      onChangeProp: 'onValueChange',
    },
  },
});
