import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';
import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

import { CollapsibleDemoContent as DemoContent } from '../CollapsibleDemoContent';
import { DemoTitle } from '../../../../components/code-highlighter/demos/DemoTitle';

const sourceEnhancers = [createEnhanceCodeEmphasis({ paddingFrameMaxSize: 3 })];

export const createDemo = createDemoFactory({
  DemoContent,
  DemoTitle,
  sourceEnhancers,
});

export const createDemoWithVariants = createDemoWithVariantsFactory({
  DemoContent,
  DemoTitle,
  sourceEnhancers,
});
