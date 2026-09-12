// Native Firebase modules are not available under Jest; they are mocked in src/services/firebase/__mocks__.
jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({}) }));
