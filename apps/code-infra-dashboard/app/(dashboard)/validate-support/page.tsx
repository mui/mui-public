import * as React from 'react';
import type { Metadata } from 'next';
import ValidateSupport from '@/views/ValidateSupport';

export const metadata: Metadata = { title: 'Validate support' };

export default function ValidateSupportPage() {
  return <ValidateSupport />;
}
