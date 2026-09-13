/**
 * Stub dos módulos `@react-native-firebase/*` para a build web.
 *
 * O React Native Firebase é um wrapper dos SDKs nativos: no browser os módulos nem existem.
 * O Metro redireciona qualquer import `@react-native-firebase/...` para este arquivo quando
 * `platform === 'web'` (ver metro.config.js), então `src/services/firebase/*` continua sendo a
 * única implementação do app — aqui só devolvemos valores neutros para a UI subir.
 *
 * A web serve para inspecionar e ajustar telas; ela não fala com o Firebase.
 * Nada aqui é usado em Android/iOS.
 */

const noop = () => undefined;
const asyncNoop = async () => undefined;
const unsubscribe = () => noop;

/** Snapshot vazio que atende tanto documento quanto coleção/consulta. */
const emptySnapshot = {
  id: '',
  exists: () => false,
  data: () => undefined,
  val: () => null,
  get: () => undefined,
  empty: true,
  size: 0,
  numChildren: () => 0,
  docs: [],
  forEach: noop,
};

/** Firestore: entrega um snapshot vazio (as telas mostram estado vazio em vez de skeleton). */
const subscribe = (_target, next) => {
  if (typeof next === 'function') setTimeout(() => next(emptySnapshot), 0);
  return noop;
};

/**
 * Realtime Database: não chama de volta.
 * `subscribeConnection` interpretaria um snapshot vazio como "offline" e a UI mostraria
 * "sem conexão" no browser; sem callback, os stores mantêm os defaults.
 */
const subscribeQuiet = () => noop;

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
 * nada disso fala com o Firebase nem vale como autenticação.
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
      authState.currentUser = {
        uid: 'web-preview-user',
        phoneNumber: phone ?? null,
        getIdToken: async () => 'web-preview-token',
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

// --- firestore ---------------------------------------------------------------
export const getFirestore = () => ({});
export const connectFirestoreEmulator = noop;
export const collection = (_db, path) => ({ path });
export const doc = (_db, path) => ({ path });
export const query = (ref) => ref;
export const where = () => ({});
export const orderBy = () => ({});
export const limit = () => ({});
export const onSnapshot = subscribe;
export const getDoc = async () => emptySnapshot;
export const getDocs = async () => emptySnapshot;

// --- realtime database -------------------------------------------------------
export const getDatabase = () => ({});
export const ref = (_db, path) => ({ path });
export const onValue = subscribeQuiet;
export const set = asyncNoop;
export const update = asyncNoop;
export const remove = asyncNoop;
export const serverTimestamp = () => Date.now();
export const onDisconnect = () => ({ set: asyncNoop, update: asyncNoop, remove: asyncNoop, cancel: asyncNoop });

// --- functions ---------------------------------------------------------------
export const getFunctions = () => ({});
export const connectFunctionsEmulator = noop;
export const httpsCallable = () => async () => ({ data: {} });

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
export const getToken = async () => '';
export const onMessage = unsubscribe;
export const onTokenRefresh = unsubscribe;

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
