import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile as updateAuthProfile,
  type User,
} from 'firebase/auth'
import { auth, firebaseReady } from '../lib/firebase'
import { getProfile, saveProfile, watchProfile } from '../lib/db'
import { DEMO_EMAIL, DEMO_UID, exitDemo, isDemo } from '../lib/demo'
import { DEFAULT_TONE, type UserProfile } from '../lib/types'

const DEMO = isDemo()

// Single-user app — this is the only account allowed in. The real
// enforcement is in firestore.rules (this check alone would not stop
// someone from reading the SDK and calling Firestore directly); this
// exists so a stray sign-in gets a clear message instead of the app
// half-loading and then failing on every read.
const ALLOWED_EMAIL = 'girwandhakal@gmail.com'

function isAllowed(u: User | null): boolean {
  return Boolean(u?.email && u.email.toLowerCase() === ALLOWED_EMAIL.toLowerCase())
}

/** Stands in for a Firebase User so no page needs to know which mode it is in. */
const DEMO_USER = {
  uid: DEMO_UID,
  email: DEMO_EMAIL,
  displayName: 'Girwan Dhakal',
} as User

interface Ctx {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  signIn(email: string, password: string): Promise<void>
  signUp(name: string, email: string, password: string): Promise<void>
  signInGoogle(): Promise<void>
  resetPassword(email: string): Promise<void>
  logout(): Promise<void>
  patchProfile(patch: Partial<UserProfile>): Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

/** Firebase's error codes are opaque to users; translate the ones they can act on. */
function friendly(e: unknown): Error {
  const code = (e as { code?: string })?.code || ''
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address is not valid.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email. Create one below.',
    'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
    'auth/weak-password': 'Use at least 6 characters for the password.',
    'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in popup.',
    'auth/network-request-failed': 'No connection. Check your network and try again.',
    'auth/operation-not-allowed': 'That sign-in method is not enabled in your Firebase console.',
    'auth/unauthorized-domain': 'This domain is not authorized in Firebase Auth settings.',
  }
  return new Error(map[code] || (e as Error)?.message || 'Authentication failed.')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(DEMO ? DEMO_USER : null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(firebaseReady && !DEMO)

  useEffect(() => {
    if (!firebaseReady || DEMO) return
    return onAuthStateChanged(auth, (u) => {
      if (u && !isAllowed(u)) {
        // A stale session from a different account (or someone else
        // entirely) — end it before anything renders behind it.
        void signOut(auth)
        setUser(null)
        setProfile(null)
        setLoading(false)
        return
      }
      setUser(u)
      if (!u) setProfile(null)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!user) return
    return watchProfile(user.uid, setProfile)
  }, [user])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password)
      if (!isAllowed(cred.user)) {
        await signOut(auth)
        throw new Error('This app is private.')
      }
    } catch (e) {
      throw friendly(e)
    }
  }, [])

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    if (!isAllowed({ email: email.trim() } as User)) {
      throw new Error('This app is private.')
    }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
      const clean = name.trim()
      if (clean) await updateAuthProfile(cred.user, { displayName: clean })
      await saveProfile(cred.user.uid, {
        name: clean,
        email: cred.user.email || email.trim(),
        school: '',
        major: '',
        gradYear: '',
        defaultTone: DEFAULT_TONE,
        onboarded: false,
      })
    } catch (e) {
      throw friendly(e)
    }
  }, [])

  const signInGoogle = useCallback(async () => {
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider())
      if (!isAllowed(cred.user)) {
        await signOut(auth)
        throw new Error('This app is private.')
      }
      // Only seed the profile on first sign-in; never overwrite an existing one.
      const existing = await getProfile(cred.user.uid)
      if (!existing) {
        await saveProfile(cred.user.uid, {
          name: cred.user.displayName || '',
          email: cred.user.email || '',
          school: '',
          major: '',
          gradYear: '',
          defaultTone: DEFAULT_TONE,
          onboarded: false,
        })
      }
    } catch (e) {
      throw friendly(e)
    }
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch (e) {
      throw friendly(e)
    }
  }, [])

  const logout = useCallback(async () => {
    // Signing out of the demo means leaving it — there is no session to end.
    if (DEMO) return exitDemo()
    await signOut(auth)
  }, [])

  const patchProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      if (!user) throw new Error('Not signed in.')
      // Update locally first so edits feel instant on a slow connection.
      setProfile((p) => ({ ...(p || ({} as UserProfile)), ...patch }))
      await saveProfile(user.uid, patch)
    },
    [user],
  )

  const value = useMemo<Ctx>(
    () => ({ user, profile, loading, signIn, signUp, signInGoogle, resetPassword, logout, patchProfile }),
    [user, profile, loading, signIn, signUp, signInGoogle, resetPassword, logout, patchProfile],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): Ctx {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Convenience for pages that only render behind the auth gate. */
export function useUid(): string {
  const { user } = useAuth()
  return user?.uid || ''
}
