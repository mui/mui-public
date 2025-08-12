import { createDemo } from '../../createDemo';
import SimpleButton from './SimpleButton';

const BasicExample = createDemo(import.meta.url, SimpleButton, {
  name: 'Basic Button',
  slug: 'basic-button',
});

export default BasicExample;
