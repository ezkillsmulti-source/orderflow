import config from './jest.config.js';

export default {
  ...config,
  testMatch: ['<rootDir>/.test-dist/test/**/*.integration.js'],
  testTimeout: 30000,
};
