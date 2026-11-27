import * as React from 'react';
import NextImage from 'next/image';

export function Image(props: React.ComponentProps<typeof NextImage>) {
  return <NextImage {...props} />;
}
