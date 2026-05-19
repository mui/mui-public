import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';

import { CollapsibleDemoContent as DemoContent } from '../CollapsibleDemoContent';
import { DemoTitle } from '../../../../components/code-highlighter/demos/DemoTitle';

const projectDir = process.env.SOURCE_CODE_ROOT_DIR;
const projectUrl = process.env.SOURCE_CODE_ROOT_URL;

export const createDemo = createDemoFactory({
  DemoContent,
  DemoTitle,
  projectDir,
  projectUrl,
});

export const createDemoWithVariants = createDemoWithVariantsFactory({
  DemoContent,
  DemoTitle,
  projectDir,
  projectUrl,
});
