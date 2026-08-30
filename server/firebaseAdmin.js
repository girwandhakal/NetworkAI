/**
 * Server-side Firebase access — used only to read stored file bytes back out
 * of Firestore, so the browser can be handed a plain URL for them and the
 * mail sender can attach the resume.
 *
 * The files themselves are written by the browser, not from here: they live
 * in Firestore rather than Cloud Storage (see src/lib/storage.ts for why),
 * and the Firestore rules are what authorize the write. This module only
 * reads, and only ever on behalf of a request that already carries the
 * per-file token minted at upload time.
 *
 * It needs a service account key,
 * generated once from Firebase Console -> Project Settings -> Service
 * Accounts -> Generate new private key, saved locally and pointed to by
 * FIREBASE_SERVICE_ACCOUNT_KEY in .env. That file grants full admin access
 * to the whole Firebase project — it must never be committed, shared, or
 * placed anywhere web-servable (see .gitignore).
 */

import fs from 'node:fs'
import path from 'node:path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

let app = null
let initError = ''

function init() {
  if (app || initError) return
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!keyPath) {
    initError = 'FIREBASE_SERVICE_ACCOUNT_KEY is not set in .env — point it at your service account key file (see README).'
    return
  }
  try {
    const resolved = path.resolve(keyPath)
    const serviceAccount = JSON.parse(fs.readFileSync(resolved, 'utf8'))
    app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) })
  } catch (e) {
    initError = `Could not load the Firebase service account key at "${keyPath}": ${e.message}`
  }
}

export function isAdminConfigured() {
  init()
  return Boolean(app)
}

function requireApp() {
  init()
  if (!app) {
    const err = new Error(initError || 'Firebase admin is not configured.')
    err.status = 503
    throw err
  }
  return app
}

function notFound() {
  const err = new Error('That file is not stored here any more. Re-upload it from the Me tab.')
  err.status = 404
  return err
}

/**
 * The bytes of one stored file, reassembled from its chunk documents.
 *
 * `token` is the random value minted when the file was written and kept in
 * its head document — the same scheme Cloud Storage's own download URLs use.
 * It is what makes an otherwise unauthenticated GET safe to serve: knowing
 * the path is not enough, and the token never leaves the owner's own
 * Firestore record.
 */
export async function readBlob(storagePath, token) {
  requireApp()
  const path = String(storagePath || '')
  const uid = path.split('/')[1] || ''
  // Mirrors blobKey() in src/lib/storage.ts — the path below the user
  // collapses into a single document id.
  const key = path.replace(/^users\/[^/]+\//, '').replace(/\//g, '~')
  if (!path.startsWith('users/') || !uid || !key || key.includes('/')) throw notFound()

  const db = getFirestore(app)
  const head = await db.doc(`users/${uid}/blobs/${key}`).get()
  if (!head.exists) throw notFound()
  const meta = head.data() || {}

  if (!meta.token || meta.token !== token) {
    const err = new Error('That file link is no longer valid. Re-open it from the app.')
    err.status = 403
    throw err
  }

  const chunks = Number(meta.chunks) || 0
  // Read by explicit index: the part ids are "0".."10", which sort
  // lexicographically in a collection query and would splice the file back
  // together in the wrong order.
  const refs = Array.from({ length: chunks }, (_, i) => db.doc(`users/${uid}/blobs/${key}/parts/${i}`))
  const snaps = refs.length ? await db.getAll(...refs) : []
  const b64 = snaps.map((s) => (s.exists ? String(s.data().b64 || '') : '')).join('')
  if (chunks && !b64) throw notFound()

  return { mime: meta.mime || 'application/octet-stream', bytes: Buffer.from(b64, 'base64') }
}
