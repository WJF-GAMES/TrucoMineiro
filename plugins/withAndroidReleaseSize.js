/**
 * Ajustes de tamanho do APK/AAB que o `expo-build-properties` não cobre.
 *
 * - `expo.gif.enabled=false`: o template do Expo liga o suporte a GIF do Fresco (Image do React
 *   Native), que traz `libgifimage.so` + `libanimation-decoder-gif.so` (~600 KB por ABI). O app não
 *   tem GIF e desenha todas as imagens com `expo-image` (Glide), que não depende do Fresco.
 *   Se um dia entrar GIF via `Image` do React Native, remova este ajuste.
 */
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  'expo.gif.enabled': 'false',
};

module.exports = function withAndroidReleaseSize(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const item = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
