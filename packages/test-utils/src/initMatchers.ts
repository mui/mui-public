import * as chai from 'chai';
import chaiDom from 'chai-dom';
import './chaiTypes';
import chaiPlugin from './chaiPlugin';

chai.use(chaiDom);
chai.use(chaiPlugin);

// Make sure to export the chai instance and plugins for declarations
export { chai, chaiDom, chaiPlugin };
