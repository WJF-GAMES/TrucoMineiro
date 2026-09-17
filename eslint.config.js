const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'android/*', 'ios/*', 'backend/*', '.migration-backup/*', 'node_modules/*', '.expo/*'] },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['react', 'react-native', 'firebase', '@react-native-firebase/*', 'expo*'] }],
    },
  },
]);
