'use client';

import { createDemoClient } from '../createDemoClient';

const ClientProvider = createDemoClient(import.meta.url);

export default ClientProvider;
