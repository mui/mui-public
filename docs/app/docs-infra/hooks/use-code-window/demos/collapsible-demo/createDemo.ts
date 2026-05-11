import 'server-only';

import {
  createDemoFactory,
  createDemoWithVariantsFactory,
} from '@mui/internal-docs-infra/abstractCreateDemo';

import { CollapsibleDemoContent as DemoContent } from '../CollapsibleDemoContent';
import { DemoTitle } from '../../../../components/code-highlighter/demos/DemoTitle';

const projectPath = process.env.SOURCE_CODE_ROOT_PATH;
const projectUrl = process.env.SOURCE_CODE_ROOT_URL;

export const createDemo = createDemoFactory({
  DemoContent,
  DemoTitle,
  projectPath,
  projectUrl,
});

export const createDemoWithVariants = createDemoWithVariantsFactory({
  DemoContent,
  DemoTitle,
  projectPath,
  projectUrl,
});
