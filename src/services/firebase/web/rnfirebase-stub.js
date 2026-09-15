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

import {
  PREVIEW_CALLABLES,
  previewCollection,
  previewDoc,
  previewRtdbValue,
} from './preview-data';

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

/** Documento de mentira no formato que `firestore.ts` espera de um snapshot real. */
const docSnapshot = (id, data) => ({
  id,
  exists: () => data != null,
  data: () => data,
  get: (field) => (data ? data[field] : undefined),
});

/** Coleção de mentira; sem dados de inspeção para o caminho, devolve o snapshot vazio. */
const collectionSnapshot = (target) => {
  const rows = previewCollection(target?.path, target?.clauses);
  if (!rows) return emptySnapshot;
  const docs = rows.map((r) => docSnapshot(r.id, r.data));
  return { ...emptySnapshot, empty: docs.length === 0, size: docs.length, docs };
};

/**
 * Firestore: entrega o conteúdo de inspeção do caminho assinado, ou um snapshot vazio.
 * As telas que não têm dados de preview continuam caindo no estado vazio, como antes.
 */
const subscribe = (target, next) => {
  if (typeof next === 'function') setTimeout(() => next(collectionSnapshot(target)), 0);
  return noop;
};

/**
 * Realtime Database.
 *
 * Só chama de volta nos caminhos que têm dado de inspeção (presença dos amigos, convites de
 * sala, contador de online). Nos demais fica calado de propósito: `subscribeConnection`
 * interpretaria um snapshot vazio como "offline" e a UI mostraria "sem conexão" no browser.
 */
const subscribeQuiet = (target, next) => {
  const value = previewRtdbValue(target?.path);
  if (value != null && typeof next === 'function') {
    setTimeout(() => next({ val: () => value, exists: () => true }), 0);
  }
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
export const collection = (_db, ...segments) => ({ path: segments.join('/') });
export const doc = (_db, ...segments) => ({ path: segments.join('/') });
/**
 * As cláusulas viajam junto com a referência: "recebidas" e "enviadas" assinam a MESMA
 * coleção (`friendRequests`) e só se distinguem pelo `where`. Sem isso as duas listas da aba
 * Solicitações receberiam o mesmo conteúdo.
 */
export const query = (ref, ...clauses) => ({
  ...ref,
  clauses: clauses.filter((c) => c && c.field !== undefined),
});
export const where = (field, op, value) => ({ field, op, value });
export const orderBy = () => ({});
export const limit = () => ({});
export const onSnapshot = subscribe;
export const getDoc = async (ref) => {
  const data = previewDoc(ref?.path);
  return data ? docSnapshot(String(ref.path).split('/').pop(), data) : emptySnapshot;
};
export const getDocs = async (ref) => collectionSnapshot(ref);

// --- realtime database -------------------------------------------------------
export const getDatabase = () => ({});
export const ref = (_db, path) => ({ path });
export const child = (parent, path) => ({ path: `${parent?.path ?? ''}/${path}` });
export const get = async (target) => {
  const value = previewRtdbValue(target?.path);
  return { val: () => value, exists: () => value != null };
};
export const onValue = subscribeQuiet;
export const set = asyncNoop;
export const update = asyncNoop;
export const remove = asyncNoop;
export const serverTimestamp = () => Date.now();
export const onDisconnect = () => ({
  set: asyncNoop,
  update: asyncNoop,
  remove: asyncNoop,
  cancel: asyncNoop,
});

// --- functions ---------------------------------------------------------------
export const getFunctions = () => ({});
export const connectFunctionsEmulator = noop;
/**
 * Toda callable devolve `{}` — menos as poucas listadas em `preview-data`, cujas telas não
 * conseguem se desenhar sem um payload completo (a aba "Minha Liga" é o caso).
 */
export const httpsCallable = (_functions, name) => {
  const preview = PREVIEW_CALLABLES[name];
  return async () => ({ data: preview ? preview() : {} });
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
