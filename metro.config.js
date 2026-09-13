const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

/**
 * Keep Metro away from native build output and the Cloud Functions workspace — watching them
 * makes the file crawler (and therefore bundle serving) extremely slow on Windows.
 */
const escape = (p) => path.join(__dirname, p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`^${escape('android')}\\\\.*`),
  new RegExp(`^${escape('ios')}\\\\.*`),
  new RegExp(`^${escape('functions')}\\\\.*`),
  new RegExp(`^${escape('artifacts')}\\\\.*`),
  new RegExp(`^${escape('references')}\\\\.*`),
  new RegExp(`^${escape('.firebase')}\\\\.*`),
];

/**
 * Web: o React Native Firebase é um wrapper dos SDKs nativos e não existe no browser.
 * Todo import `@react-native-firebase/*` cai num stub neutro para a UI poder ser
 * inspecionada no navegador (Android/iOS continuam usando o SDK real).
 */
const RNFIREBASE_WEB_STUB = path.resolve(__dirname, 'src/services/firebase/web/rnfirebase-stub.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName.startsWith('@react-native-firebase/')) {
    return { type: 'sourceFile', filePath: RNFIREBASE_WEB_STUB };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
