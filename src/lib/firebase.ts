import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** False when .env has not been filled in — the app shows a setup screen instead of crashing.
 *  storageBucket is included because context capture (photos/video/voice) depends on Storage
 *  being configured just as much as auth/Firestore do — without it, getStorage() below throws. */
export const firebaseReady = Boolean(cfg.apiKey && cfg.projectId && cfg.appId && cfg.storageBucket)

export const missingFirebaseKeys = Object.entries({
  VITE_FIREBASE_API_KEY: cfg.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: cfg.authDomain,
  VITE_FIREBASE_PROJECT_ID: cfg.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: cfg.storageBucket,
  VITE_FIREBASE_APP_ID: cfg.appId,
})
  .filter(([, v]) => !v)
  .map(([k]) => k)

let app: FirebaseApp | null = null
let authRef: Auth | null = null
let dbRef: Firestore | null = null
let storageRef: FirebaseStorage | null = null

if (firebaseReady) {
  app = initializeApp(cfg)
  authRef = getAuth(app)
  // Persistent local cache keeps reads and writes working on venue Wi-Fi that
  // drops out mid-fair; queued writes flush automatically on reconnect.
  dbRef = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  try {
    storageRef = getStorage(app)
  } catch {
    // A malformed (rather than missing — that's caught by firebaseReady
    // above) bucket value would otherwise throw here at module load and
    // take the whole app down before React ever renders.
    storageRef = null
  }
}

/** Only call these behind a `firebaseReady` guard. */
export const auth = authRef as Auth
export const db = dbRef as Firestore
export const storage = storageRef as FirebaseStorage
