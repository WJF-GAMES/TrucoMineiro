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

/** Assina algo que nunca muda: entrega um snapshot vazio e devolve o unsubscribe. */
const subscribe = (_target, next) => {
  if (typeof next === 'function') setTimeout(() => next(emptySnapshot), 0);
  return noop;
};

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
export const getAuth = () => ({ currentUser: null });
export const connectAuthEmulator = noop;
/** Sem sessão no browser: avisa "deslogado" para o app sair do splash e cair na Introdução. */
export const onAuthStateChanged = (_auth, cb) => {
  if (typeof cb === 'function') setTimeout(() => cb(null), 0);
  return noop;
};
export const signInWithPhoneNumber = async () => {
  throw new Error('Login por telefone não está disponível na build web.');
};
export const signOut = asyncNoop;

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
export const onValue = subscribe;
export const set = asyncNoop;
export const update = asyncNoop;
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
