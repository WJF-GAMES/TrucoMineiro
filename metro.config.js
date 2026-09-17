const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

/**
 * Keep Metro away from native build output and the backend workspace — watching them
 * makes the file crawler (and therefore bundle serving) extremely slow on Windows.
 */
const escape = (p) => path.join(__dirname, p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  new RegExp(`^${escape('android')}\\\\.*`),
  new RegExp(`^${escape('ios')}\\\\.*`),
  new RegExp(`^${escape('backend')}\\\\.*`),
  new RegExp(`^${escape('.migration-backup')}\\\\.*`),
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

/**
 * Mesma história para o Google Mobile Ads: o SDK importa componentes nativos (codegen) e o
 * bundle web quebra só de encostar nele. Na web não existe anúncio — o stub mantém o módulo
 * `src/ads` inteiro compilando, quieto.
 */
const ADS_WEB_STUB = path.resolve(__dirname, 'src/ads/web/google-mobile-ads-stub.js');

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    if (moduleName.startsWith('@react-native-firebase/')) {
      return { type: 'sourceFile', filePath: RNFIREBASE_WEB_STUB };
    }
    if (moduleName === 'react-native-google-mobile-ads') {
      return { type: 'sourceFile', filePath: ADS_WEB_STUB };
    }
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
