import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

if (getApps().length === 0) {
  initializeApp({ databaseURL: 'https://truco-mineiro-wjf-default-rtdb.firebaseio.com' });
}

export const db = getFirestore();
export const rtdb = getDatabase();
export const auth = getAuth();
export const messaging = getMessaging();

export const REGION = 'southamerica-east1';
/**
 * Realtime Database (Eventarc) triggers are not available in southamerica-east1 yet, so the two
 * database-triggered functions run in us-central1. Callables stay close to the players.
 */
export const DB_TRIGGER_REGION = 'us-central1';
export const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * App Check enforcement. Stays off until App Check is actually configured in the Console
 * (API enabled + Play Integrity/App Attest registered with the app's SHA fingerprints);
 * with it on beforehand every callable rejects the client's placeholder token
 * ("verifications":{"app":"INVALID"}). Flip ENFORCE_APP_CHECK=true in functions/.env after setup.
 */
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true';

export const now = () => Date.now();
