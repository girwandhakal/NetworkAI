import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** False when .env has not been filled in — the app shows a setup screen instead of crashing.
 *  storageBucket is deliberately not required: nothing in the app touches Cloud Storage any
 *  more (see storage.ts — file bytes live in Firestore), so a project with no bucket is fine. */
export const firebaseReady = Boolean(cfg.apiKey && cfg.projectId && cfg.appId)

export const missingFirebaseKeys = Object.entries({
  VITE_FIREBASE_API_KEY: cfg.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: cfg.authDomain,
  VITE_FIREBASE_PROJECT_ID: cfg.projectId,
  VITE_FIREBASE_APP_ID: cfg.appId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k)

let app: FirebaseApp | null = null
let authRef: Auth | null = null
let dbRef: Firestore | null = null

if (firebaseReady) {
  app = initializeApp(cfg)
  authRef = getAuth(app)
  // Persistent local cache keeps reads and writes working on venue Wi-Fi that
  // drops out mid-fair; queued writes flush automatically on reconnect.
  dbRef = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
}

/** Only call these behind a `firebaseReady` guard. */
export const auth = authRef as Auth
export const db = dbRef as Firestore
