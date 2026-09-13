/* eslint-disable @typescript-eslint/no-require-imports --
 * Fábricas de `jest.mock` são hasteadas acima dos imports, então só `require` funciona aqui.
 */
// Native Firebase modules are not available under Jest; they are mocked in src/services/firebase/__mocks__.
jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({}) }));

// Analytics e Remote Config entram em qualquer tela pela via dos anúncios, então precisam de um
// mock global — sem ele, montar uma tela em teste tenta abrir o módulo nativo.
jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: () => ({}),
  logEvent: jest.fn(),
  logScreenView: jest.fn(() => Promise.resolve()),
  setUserId: jest.fn(() => Promise.resolve()),
  setUserProperty: jest.fn(() => Promise.resolve()),
}));
jest.mock('@react-native-firebase/remote-config', () => ({
  getRemoteConfig: () => ({ settings: {}, defaultConfig: {} }),
  fetchAndActivate: jest.fn(() => Promise.resolve(true)),
  // Sem fetch, todo flag cai no default declarado em remoteConfigDefaults.
  getValue: () => ({ asBoolean: () => false, asNumber: () => 0, asString: () => '' }),
}));

// React 19 exige a marcação explícita do ambiente de act() para os testes de componente.
(global as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Ionicons carrega expo-font/expo-asset, que não existem no ambiente de teste.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

// AsyncStorage é módulo nativo: sem isso qualquer teste que toque um store persistido quebra.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * Reanimated 4 exige o runtime nativo de worklets — até o mock oficial carrega
 * `react-native-worklets` e quebra sob Jest. O app só usa `Animated.View` e presets de layout
 * animation, então este mock cobre a superfície inteira: componentes viram Views e cada preset é
 * um builder encadeável que não faz nada.
 */
jest.mock('react-native-reanimated', () => {
  const { View, Text, ScrollView, Image } = require('react-native');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['delay', 'duration', 'springify', 'damping', 'withInitialValues', 'build'])
      chain[method] = () => chain;
    return chain;
  };
  const presets = [
    'FadeIn', 'FadeInUp', 'FadeInDown', 'FadeOut', 'FadeOutUp', 'FadeOutDown', 'ZoomIn', 'ZoomOut',
  ];
  const easing = () => (t: number) => t;
  const api: Record<string, unknown> = {
    __esModule: true,
    default: Object.assign(View, { View, Text, ScrollView, Image, createAnimatedComponent: (c: unknown) => c }),
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useAnimatedProps: (fn: () => unknown) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    withDelay: (_d: number, v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (...v: unknown[]) => v[v.length - 1],
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    runOnUI: (fn: unknown) => fn,
    interpolate: (_v: number, _i: number[], o: number[]) => o[0],
    // Superfície que o react-native-gesture-handler usa ao montar um <GestureDetector />.
    useEvent: () => () => undefined,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }),
    useAnimatedReaction: () => undefined,
    useAnimatedRef: () => ({ current: null }),
    setGestureState: () => undefined,
    isSharedValue: (v: unknown) => Boolean(v && typeof v === 'object' && 'value' in (v as object)),
    makeMutable: (v: unknown) => ({ value: v }),
    measure: () => null,
    interpolateColor: (_v: number, _i: number[], o: string[]) => o[0],
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    Easing: {
      linear: (t: number) => t,
      ease: (t: number) => t,
      quad: (t: number) => t,
      cubic: (t: number) => t,
      sin: (t: number) => t,
      in: easing,
      out: easing,
      inOut: easing,
      bezier: () => ({ factory: easing }),
    },
  };
  for (const name of presets) api[name] = builder();
  return api;
});
