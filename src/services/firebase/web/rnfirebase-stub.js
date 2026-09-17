/**
 * Stub dos módulos `@react-native-firebase/*` para a build web.
 *
 * O React Native Firebase é um wrapper dos SDKs nativos: no browser os módulos nem existem.
 * O Metro redireciona qualquer import `@react-native-firebase/...` para este arquivo quando
 * `platform === 'web'` (ver metro.config.js), então `src/services/firebase/*` continua sendo a
 * única implementação do app — aqui só devolvemos valores neutros para a UI subir.
 *
 * A web serve para inspecionar e ajustar telas. Os dados vêm do backend local (NestJS em
 * `AUTH_MODE=test`), que aceita o token de inspeção gerado abaixo. Nada aqui é usado em
 * Android/iOS.
 */

const noop = () => undefined;
const asyncNoop = async () => undefined;
const unsubscribe = () => noop;

// --- app ---------------------------------------------------------------------
const app = { name: '[DEFAULT]', options: {} };
export const getApp = () => app;

// --- analytics ---------------------------------------------------------------
export const getAnalytics = () => ({});
export const logEvent = asyncNoop;
export const logScreenView = asyncNoop;
export const setUserProperty = asyncNoop;

// --- crashlytics (setUserId é compartilhado com analytics) --------------------
export const getCrashlytics = () => ({});
export const setUserId = asyncNoop;
export const log = noop;
export const recordError = noop;
export const setAttributes = asyncNoop;

// --- app check ---------------------------------------------------------------
export class ReactNativeFirebaseAppCheckProvider {
  configure() {}
}
export const initializeAppCheck = async () => ({});

// --- auth --------------------------------------------------------------------
/**
 * Sessão de mentira só para a build web: o SDK nativo não existe no browser.
 * Serve para navegar pelas telas (Login -> OTP -> Cadastro -> app) e ajustar layout;
 * nada disso vale como autenticação fora do backend local de testes.
 */
const authState = { currentUser: null };
const authListeners = new Set();
const notifyAuth = () => authListeners.forEach((cb) => cb(authState.currentUser));

export const getAuth = () => authState;
export const connectAuthEmulator = noop;
export const onAuthStateChanged = (_auth, cb) => {
  if (typeof cb !== 'function') return noop;
  authListeners.add(cb);
  setTimeout(() => cb(authState.currentUser), 0);
  return () => authListeners.delete(cb);
};
export const signInWithPhoneNumber = async (_auth, phone) => {
  console.warn('[web] envio de SMS simulado: o login de verdade só roda no Android/iOS.');
  return {
    verificationId: 'web-preview',
    confirm: async (code) => {
      if (!/^\d{6}$/.test(String(code ?? ''))) {
        const err = new Error('Código inválido.');
        err.code = 'auth/invalid-verification-code';
        throw err;
      }
      console.warn('[web] código aceito sem verificação (build de inspeção).');
      const uid = `webpreview${String(phone ?? '').replace(/\D/g, '').slice(-6)}`;
      authState.currentUser = {
        uid,
        phoneNumber: phone ?? null,
        // Formato aceito pelo backend local em AUTH_MODE=test.
        getIdToken: async () => `test:${uid}:${phone ?? ''}`,
      };
      notifyAuth();
      return { user: authState.currentUser };
    },
  };
};
export const signOut = async () => {
  authState.currentUser = null;
  notifyAuth();
};

// --- messaging ---------------------------------------------------------------
export const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
};
export const getMessaging = () => ({});
/** Negado: o app pula o registro de push sem erro. */
export const requestPermission = async () => AuthorizationStatus.DENIED;
/** Serve ao App Check e ao Messaging (sem token nos dois casos). */
export const getToken = async () => '';
export const onMessage = unsubscribe;
export const onTokenRefresh = unsubscribe;
export const deleteToken = asyncNoop;
/** Navegador não recebe push: nenhuma notificação abriu o app. */
export const getInitialNotification = async () => null;
export const onNotificationOpenedApp = unsubscribe;
export const setBackgroundMessageHandler = noop;

// --- performance -------------------------------------------------------------
export const getPerformance = () => ({});
export const trace = () => ({ putAttribute: noop, start: asyncNoop, stop: asyncNoop });

// --- remote config -----------------------------------------------------------
const remoteConfig = { defaultConfig: {}, settings: {} };
export const getRemoteConfig = () => remoteConfig;
export const fetchAndActivate = async () => false;
/** Devolve o default que o app já registrou em `defaultConfig`. */
export const getValue = (rc, key) => {
  const value = (rc?.defaultConfig ?? {})[key];
  return {
    asBoolean: () => value === true || value === 'true',
    asNumber: () => Number(value ?? 0),
    asString: () => String(value ?? ''),
    getSource: () => 'default',
  };
};
