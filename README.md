# Network.Ai

Capture a career-fair conversation in under thirty seconds. Walk out with the follow-up emails and LinkedIn notes already written.

Voice note or photo in → structured contact record, a personalized follow-up email, and a sub-300-character LinkedIn note out. Everything is editable afterwards, and any capture can be re-run.

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill it in — see below
npm run dev               # API on :8787, app on http://localhost:5173
```

If `.env` is not filled in yet, the app opens on a setup screen that walks through the same steps and shows you live what is still missing.

---

## Just want to look around first?

Run `npm run dev` with no keys at all and click **Try it with sample data** on the setup screen.

Demo mode swaps Firebase for an in-memory store seeded with two events and eight contacts covering every state the app can be in — drafted, sent, replied, a low-confidence pamphlet scan that needs checking, LinkedIn notes both added and pending. Every screen and interaction works: editing, tone switching, batch selection, search, filters.

- Data lives in `localStorage` only. **Reset** re-seeds it, **Exit** clears it — both in the bar at the top.
- If `OPENAI_API_KEY` is set, recording and drafting hit the **real** model. If not, they return sample results.
- Email is **never actually sent** in demo mode, even if sending is configured.

---

## What you need to supply

### 1. OpenAI API key — required

Create one at **https://platform.openai.com/api-keys**. There is no free tier — billing has to be set up on the account.

```
OPENAI_API_KEY=your-key
```

Text and image capture use `gpt-4o` by default; voice notes are transcribed with `whisper-1` first, then folded in as text. Override either with `OPENAI_MODEL` / `OPENAI_TRANSCRIBE_MODEL`.

### 2. Firebase project — required

Your data lives in **your own** Firebase project. At https://console.firebase.google.com:

1. Create a project.
2. **Build → Authentication → Sign-in method** → enable **Email/Password**. Enable **Google** too if you want the Google button to work.
3. **Build → Firestore Database → Create database** (production mode is fine — the rules below lock it down).
4. **Firestore → Rules** → paste the contents of [`firestore.rules`](firestore.rules) → **Publish**.
5. **Build → Storage → Get started** (production mode). This is where every photo and voice note you capture is kept, so a contact's context survives closing the app and comes back on any device.
6. **Storage → Rules** → paste the contents of [`storage.rules`](storage.rules) → **Publish**.
7. **Project settings → Your apps → Web app** → copy the config values into `.env`:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

> Vite only reads `.env` at startup — restart `npm run dev` after editing it.

### 3. Email sending — optional

Without this, every draft still generates and copies; only the in-app **Send** button is disabled. Pick one:

**Resend** (recommended for bulk sends — a transactional API, not your personal inbox):

```
RESEND_API_KEY=re_...
MAIL_FROM=you@your-verified-domain.com
```

`MAIL_FROM` must be on a domain you have verified in Resend.

**Or your own SMTP mailbox** (Gmail needs an [App Password](https://myaccount.google.com/apppasswords), not your login password):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
MAIL_FROM=you@gmail.com
```

Bulk sends are throttled — `MAIL_THROTTLE_MS` (default 1200ms) is the gap between messages, which keeps a personal mailbox under provider rate limits.

---

## Using it on your phone

`npm run dev` binds to your network, so open `http://<your-computer-ip>:5173` on a phone on the same Wi-Fi. Microphone and camera access require a secure context — for a real fair, either deploy it or run it through a tunnel (`npx localtunnel --port 5173`, ngrok, etc.). On `localhost` they work as-is.

---

## Your resume

There's no profile form anywhere — name, school, major, target roles, all of it comes straight off your resume. Upload one during onboarding, or later from the **Resume** tab or **Me → Resume**; parsing it is what fills in the rest. Uploading a newer one re-parses and replaces everything, including the file itself — that's the only way to change any of it.

The actual file (not just its extracted text) is kept in Firebase Storage, which is also what "append resume" on a follow-up email attaches at send time. Pasting text instead of uploading a file gets you the extracted profile fields but nothing to preview or attach — there's no document behind it to keep.

Note that most mobile browsers refuse to render a PDF inline; on those you get a tap-to-open button instead of an embedded preview. Non-PDF resumes (Word, plain text) get parsed the same way but aren't previewable in-app either.

---

## How it works

```
Event  ("Fall 2026 Tech Career Fair")
  └── Contacts        one per person or booth you captured
        ├── Email queue      select several, send in one batch
        └── LinkedIn list    copy a note, paste it in by hand
```

**Capture is fire-and-forget.** Tapping stop writes the contact record immediately, then the upload and extraction run in the background — so nothing blocks you before the next booth. Firestore's local cache absorbs the write when you are offline, and an IndexedDB job queue holds the regeneration until the connection comes back. The queue depth shows in a bar at the top of the app.

**A contact keeps every photo, voice note, and typed note you ever add to it as standing context** — not just the one that created it. Adding another one re-reads all of it together and rewrites the extracted fields, the notes, the email, and the LinkedIn note as one coherent pass, the way Claude or Gemini "projects" work. Several items added in one go (three photos at once, say) still cost one regeneration, not one per item.

**Nothing gates you behind a review step.** Extraction is never perfect, so instead: every field is inline-editable on the contact record, low-confidence extractions get a visible "worth a second look" flag with the model's own confidence number, and context items can be added or removed from the record at any time.

**Email vs. LinkedIn is asymmetric on purpose.** Email can be sent programmatically, so the email queue does batch sends. LinkedIn has no supported API for sending a connection request with a note, so that side is a worklist: copy, open the profile, paste, tick it off. It never pretends to send anything.

---

## Endpoints

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` | Reports whether OpenAI and email are configured |
| `GET /api/resume-file` | Proxies the uploaded resume from Firebase Storage for the in-app viewer (sidesteps a browser CORS restriction the direct Storage URL would hit) |
| `POST /api/parse-resume` | PDF/Word/text resume → structured profile + transcript |
| `POST /api/generate-context` | Every photo/voice-note/typed-note captured for a contact so far → the whole record rewritten in one pass |
| `POST /api/generate-followup` | Rewrites the follow-ups in a different tone, or to a freeform instruction |
| `POST /api/send-email` | Sends one or many, throttled, with per-recipient results |

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API server + Vite dev server together |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm start` | Serve the built app and the API from one process |

---

## Privacy

Single-user by design. Contact details and your resume go to OpenAI to produce the summaries and drafts — that is the tradeoff the app is built on. Voice notes are additionally sent to OpenAI's transcription endpoint before that. Photos and voice notes are kept — that is what lets adding one later regenerate a contact from everything captured about them, not just the newest item — in Firebase Storage under `/users/{yourUid}`, gated by `storage.rules` the same way Firestore is. One caveat that rules can't close: each file's download URL carries its own access token, so anyone who obtains that exact URL (from browser history, a shared screenshot, a proxy log) can fetch that one file without signing in at all — normal Firebase Storage behavior, not a bug specific to this app, but worth knowing before treating a captured photo or voice note as private once its URL has left your hands. Nothing is stored server-side; the server only ever forwards bytes to OpenAI for that one request, it does not persist anything itself.
