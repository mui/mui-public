'use client';

import { createDemoClient } from '../createDemoClient';

const ClientProvider = createDemoClient(import.meta.url, { options: true });

export default ClientProvider;
