# Product Requirements Document (PRD)

## App Idea: Network.Ai (AI Career Fair Networking Assistant)

---

## 1. Product Overview

### Problem
Career fairs, tech conferences, and networking events move fast. Students and professionals meet dozens of recruiters, engineering leads, founders, or peers in a short window. Remembering who was met, what was discussed, and sending timely, high-quality follow-ups is difficult. Common failure points:
* Business cards and company pamphlets are collected but get misplaced or forgotten.
* Manual note-taking during fast conversations is awkward or impractical.
* Key conversation nuances (hobbies, specific advice, project mentions) fade quickly.
* Delayed or generic follow-up emails lead to low response rates.

Generic tools (phone notes, a stack of business cards, a spreadsheet) fail because they require manual structuring *after* the event, when memory has already faded and motivation has dropped. The gap Network.Ai fills is **structuring at the moment of capture** — turning a 20-second voice note or a card photo into a structured, ready-to-act-on record before the details are lost.

### Proposed Solution
**Network.Ai** is an AI-powered networking memory assistant. It lets users capture contact details and conversation context in under 30 seconds via **Voice Record** or **Universal Image Capture** (business cards, pamphlets, flyers, badges), automatically structures the key details, and generates hyper-personalized follow-up emails and LinkedIn connection notes using the user's uploaded resume and profile. Emails can be sent directly from the app, individually or in bulk; LinkedIn connection notes cannot be sent programmatically, so those are generated for the user to paste in manually when adding the connection.

Because extraction (OCR and speech-to-text) is never 100% reliable, records are saved directly rather than gated behind a review step — capture stays uninterrupted at <30s. Every field remains editable after the fact from the contact record, and a capture can be re-run (re-transcribed/re-OCR'd) if the result was wrong, so correction happens on the user's own time instead of blocking the next capture.

### Core Goal
**Meet someone → 1-Tap Capture in < 30s → Extract & save structured memory → Edit or regenerate anytime → Send personalized follow-ups & LinkedIn notes.**

---

## 2. Target Audience & User Personas

* **Primary Persona (College Student / Job Seeker):** Attending university career fairs, tech expos, or hackathons. Goal: land interviews or referrals by standing out with prompt, personal follow-ups.
* **Secondary Persona (Professional / Founder / Recruiter):** Attending industry conferences. Goal: build strategic relationships without spending hours organizing contacts post-event.

---

## 3. Layered Product Architecture

```
Level 1: High-Level Event ("Fall 2026 Tech Career Fair")
  │
  ├── Level 2: List of Interactions (Raw Feed of Contacts & Company Sheets met)
  │
  └── Level 3: Actionable Execution Queues
        ├── 📧 1. Follow-up Email Queue (Review, Tone Switch, 1-Tap Copy, & Bulk Send)
        └── 🔗 2. LinkedIn Connection List (Name + Personalized <300-char note, for manual add — no automated sending)
```

**Email vs. LinkedIn asymmetry (intentional):** email can be sent programmatically (SMTP/provider API), so the Email Queue supports selecting multiple drafts and sending them in one batch. LinkedIn has no equivalent — there's no supported way to programmatically send a connection request with a note on someone's behalf. So the LinkedIn Connection List is not a send queue at all; it's a reference list of **who to add** and **what note to paste in**, worked through manually inside the LinkedIn app/site.

---

## 4. Minimal Dual-Input Capture Specification

To minimize friction, the app requires **zero manual image classification**. The user has only two primary inputs per interaction:

1. **Voice Record Button:** User dictates a 15–20 second post-conversation summary.
2. **Add Image Button:** User snaps a photo of *any* item (business card, company pamphlet, booth info sheet, banner, or event badge). The multimodal Gemini LLM automatically identifies the document type and extracts relevant metadata.

**No blocking review step:** extracted fields (name, company, title, contact info, summary) are written straight to Firestore — capture is fire-and-forget. Correction happens later, from the saved contact record: any field can be edited inline, and the voice/image capture can be re-run to regenerate the AI-derived fields if the original extraction was off.

---

## 5. In-App Resume Reference & Context Tab

A dedicated **Resume Tab** in the navigation enables the user to:
* **Quick Reference:** View their full uploaded resume transcript, target roles, and key experiences on the fly during conversations.
* **AI Context Sync:** Automatically feed resume text into LLM prompts for email drafting and LinkedIn connection note generation.

---

## 6. Technical Architecture & Data Schema

### 6.1 Authentication & Scoping
All data is scoped under `/users/{userId}`, gated by an authenticated session (e.g., Firebase Auth). No cross-user reads. This is assumed but not yet detailed — auth provider and session handling need their own spec before implementation.

### 6.2 Data Models (Firestore Hierarchy)

```
/users/{userId} (UserProfile)
  ├── name: string
  ├── school: string
  ├── major: string
  ├── gradYear: string
  ├── targetRoles?: string
  ├── experiences?: string
  ├── emailPreference?: string
  ├── resumeText?: string
  └── resumeFileName?: string

/users/{userId}/events/{eventId} (Event)
  ├── id: string
  ├── name: string
  ├── date: string
  ├── location?: string
  └── contactCount: number   // denormalized; see note below

/users/{userId}/events/{eventId}/contacts/{contactId} (Contact)
  ├── id: string
  ├── name: string
  ├── company: string
  ├── title?: string
  ├── email?: string
  ├── phone?: string
  ├── website?: string
  ├── linkedin?: string
  ├── notes?: string
  ├── priority: "High" | "Medium" | "Low"        // AI-suggested on save, user-editable
  ├── status: "Needs follow-up" | "Draft ready" | "Waiting for response" | "Replied" | "No action needed"  // starts AI/system-set, user can override at any time
  ├── emailDraft?: string
  ├── emailTone?: string
  ├── summary?: { topic, details, connection, action }
  └── createdAt: string
```

> **Note on `contactCount`:** this is a denormalized counter, not a live query result. It must be updated atomically with contact writes (e.g., a Firestore transaction or a Cloud Function trigger on the `contacts` subcollection) — otherwise it will drift from the actual subcollection size.

### 6.3 Server Endpoints (Express + Gemini API)
* `GET /api/health` — checks environment configuration (`GEMINI_API_KEY`).
* `POST /api/parse-resume` — parses PDF/text resume into a structured profile.
* `POST /api/ocr-card` — extracts business card & document details from an image.
* `POST /api/summarize-notes` — generates structured summary, email draft, and LinkedIn note from a voice transcript.

All three LLM endpoints use **Gemini 2.5 Flash**. (The previous draft listed `/api/parse-resume` as using "Gemini 3.5 Flash" — not a real model; confirm the intended model against current Gemini API offerings before implementation, since model names/availability change.)

---

## 7. Privacy & Data Handling

**Scope note:** this is currently a personal, single-user app (built for the author's own use), not a product handling other users' data. PII exposure to the AI vendor (Gemini) is an accepted tradeoff for now — no consent flows, export tooling, or vendor-data-processing disclosures are needed at this stage. Revisit this section if the app is ever opened up to other users, since collecting other people's (recruiters', peers') contact info without their knowledge changes the calculus.

The one practical item worth keeping regardless of scale: don't let raw voice audio and card images pile up indefinitely in storage once they've been extracted — clean up after a successful capture+review to avoid unbounded storage growth, not for compliance reasons.

---

## 8. Risks & Open Questions

* **Mass email deliverability:** sending multiple follow-ups in a batch through a single account risks provider rate limits or spam flagging if done through a personal inbox (Gmail/Outlook). Needs a sending mechanism chosen with that in mind (e.g., a transactional email API, or throttled sends through the user's own account) — not an afterthought once volume shows up.
* **Venue connectivity:** career fairs are often in crowded venues with poor Wi-Fi/cell coverage. The "<30s capture" goal depends on live API calls to Gemini; needs an offline-queue fallback (capture locally, process when connectivity returns) or the core promise breaks in the exact environment it's built for.
* **API cost/rate limits at scale:** a busy fair could mean 30+ image/voice captures per user in a couple of hours, each hitting the Gemini API at least twice (extract + summarize/draft). Cost per user and rate-limit headroom should be modeled before launch.
* **Extraction accuracy on noisy inputs:** badges and pamphlets vary wildly in layout; OCR misreads are expected, not exceptional. Since there's no blocking review step, a bad extraction can sit unnoticed in a contact record until the user happens to open it — worth surfacing low-confidence extractions somehow (e.g., a visual flag on the contact card) rather than relying on the user to catch every miss manually.

---

## 9. Out of Scope (MVP)

To keep the MVP scoped, the following are explicitly **not** included in v1:
* Fully autonomous/scheduled sending — email sends (single or bulk) are user-initiated, not triggered automatically on a timer or event.
* Any automated LinkedIn connection sending — LinkedIn has no supported API for this; the LinkedIn queue is and stays a manual-reference list (see §3).
* Cross-user or team/shared contact lists.
* Calendar integration or interview scheduling.
* Contact deduplication across multiple events (same person met twice).

---

## 10. Success Metrics & KPIs

* **Capture Time:** median time from tapping capture to a saved contact record is under 30 seconds.
* **Follow-up Generation Rate:** >80% of saved contacts have an AI-generated follow-up draft created (not necessarily sent).
* **Resume Context Utilization:** when a resume is uploaded, generated email drafts reference at least one specific resume detail (project, skill, or experience) in >90% of cases — measured by spot-checking a sample, not asserted as a hard guarantee, since LLM output isn't deterministic.
* **Post-hoc edit/regenerate rate:** track how often saved contacts get manually edited or re-captured after the fact, as a proxy for extraction accuracy over time (a high rate on a given field flags a prompt/model issue worth fixing).

---

## 11. Verification & Development Commands

* Development server: `npm run dev`
* Production build: `npm run build`
