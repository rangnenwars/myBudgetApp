/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  setupFiles: ['dotenv/config', '<rootDir>/src/__tests__/setupEnv.ts'],
  globalTeardown: '<rootDir>/src/__tests__/globalTeardown.ts',
  // These integration tests hit a real Postgres (see docs/MASTER_BUILD_PROMPT_v3_BACKEND.md
  // "no mocking the database") — allow enough time for real queries.
  testTimeout: 15000,
  // The shared pg Pool (db/client.ts) is a module-level singleton reused
  // across every test file and never explicitly closed — normal for a
  // long-lived server, but it leaves Jest with an open handle at the end
  // of a test run. forceExit is the standard fix rather than adding
  // teardown plumbing to close a pool that's supposed to stay open.
  forceExit: true,
  // jobs/ counts too (the nightly digest and retention); its run-*.ts files are
  // thin CLI wrappers around runIssueDigest/analyzeIssues, exercised by hand.
  collectCoverageFrom: ['src/routes/**/*.ts', 'src/middleware/**/*.ts', 'src/lib/**/*.ts', 'src/jobs/**/*.ts', '!src/jobs/run-*.ts'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
};
