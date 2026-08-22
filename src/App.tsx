import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ContactDetail } from './pages/ContactDetail'
import { EventDetail } from './pages/EventDetail'
import { Events } from './pages/Events'
import { Followups } from './pages/Followups'
import { Me } from './pages/Me'
import { Onboarding } from './pages/Onboarding'
import { Resume } from './pages/Resume'
import { Setup } from './pages/Setup'
import { SignIn } from './pages/SignIn'
import { AuthProvider, useAuth } from './state/Auth'
import { DataProvider } from './state/Data'
import { ToastProvider } from './state/Toast'
import { firebaseReady } from './lib/firebase'
import { isDemo } from './lib/demo'

export default function App() {
  // Demo mode replaces Firebase entirely, so the setup gate does not apply.
  if (!firebaseReady && !isDemo()) {
    return (
      <ToastProvider>
        <div className="shell">
          <Setup />
        </div>
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>
          <Gate />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>
  )
}

function Gate() {
  const { user, profile, loading } = useAuth()
  const [waited, setWaited] = useState(false)

  // If the profile doc never shows up (first Google sign-in, a failed seed
  // write), fall through to onboarding rather than spinning forever.
  useEffect(() => {
    setWaited(false)
    if (!user || profile) return
    const id = window.setTimeout(() => setWaited(true), 2500)
    return () => window.clearTimeout(id)
  }, [user, profile])

  if (loading) {
    return (
      <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="spin" style={{ width: 22, height: 22 }} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="shell">
        <SignIn />
      </div>
    )
  }

  // profile === null means the doc has not arrived yet; wait rather than
  // flashing onboarding at a returning user.
  if (profile === null && !waited) {
    return (
      <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="spin" style={{ width: 22, height: 22 }} />
      </div>
    )
  }

  if (!profile?.onboarded) {
    return (
      <div className="shell">
        <Onboarding />
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Events />} />
        <Route path="/followups" element={<Followups />} />
        <Route path="/resume" element={<Resume />} />
        <Route path="/me" element={<Me />} />
        <Route path="/e/:eventId" element={<EventDetail />} />
        <Route path="/e/:eventId/c/:contactId" element={<ContactDetail />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
