/** Dois projetos: `unit` (sem banco) e `integration` (PostgreSQL real, DATABASE_URL de teste). */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', isolatedModules: true }] },
  testEnvironment: 'node',
  rootDir: '.',
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: [
        '<rootDir>/src/**/*.spec.ts',
        '<rootDir>/test/unit/**/*.spec.ts',
        '<rootDir>/src/domain/**/__tests__/*.test.ts',
      ],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts', '<rootDir>/test/e2e/**/*.spec.ts'],
      globalSetup: '<rootDir>/test/setup/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/after-env.ts'],
    },
  ],
};
