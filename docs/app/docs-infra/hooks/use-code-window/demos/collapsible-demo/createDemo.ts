import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';

import { CollapsibleDemoContentLazy as DemoContent } from '../CollapsibleDemoContentLazy';
import { CollapsibleDemoContentLoading as DemoContentLoading } from '../CollapsibleDemoContentLoading';
import { DemoTitle } from '../../../../components/code-highlighter/demos/DemoTitle';

const projectDir = process.env.SOURCE_CODE_ROOT_DIR;
const projectUrl = process.env.SOURCE_CODE_ROOT_URL;

export const createDemo = createDemoFactory({
  DemoContentLoading,
  DemoContent,
  DemoTitle,
  projectDir,
  projectUrl,
});

export const createDemoWithVariants = createDemoWithVariantsFactory({
  DemoContentLoading,
  DemoContent,
  DemoTitle,
  projectDir,
  projectUrl,
});
