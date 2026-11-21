# Rehab Passport: rebuild brief (A to Z)

Give this file to a new chat in a new repo and say:
**"Read docs/REBUILD.md and build this app, phase by phase. Ask me only what the brief does not answer."**

It is written so the new chat needs nothing else from you. Everything below was decided and tested in the
first build (Oct to Nov 2026, live at rehab-passport.vercel.app). Section 14 lists what to copy instead of
rewriting.

---

## 1. What it is

A 3rd-year BPT (physiotherapy) college "innovation concept poster" turned into a working web app.

- **Problem:** patients forget or skip home exercises; paper handouts get lost; therapists cannot see
  what happened between visits.
- **Idea:** a **paper exercise passport** the patient keeps, with an **optional QR code** that opens
  the same plan on their phone. The patient ticks exercises and writes a daily pain score; the therapist
  sees it at the next visit (or live, if the patient used the phone).
- **Flow (the poster's five steps):** Assess → Personalize → Demonstrate → Track → Review.
- **Claim:** feasibility only. **No clinical effectiveness is claimed** anywhere in the app. Say this on
  the Evaluation page and the About page.
- **Users:** (1) the therapist/clinician, on a laptop or phone, in English; (2) the patient, on paper and
  optionally a phone, in **English, Punjabi (Gurmukhi) or both**. Many patients are older and not
  tech-confident: big text, big buttons, paper first.
- **Privacy rule:** patients are entered with a code (P-001), initials and age only. Never real names.
  The patient's phone page never shows name or diagnosis.

## 2. Stack

- **Next.js 16 (App Router) + React 19 + TypeScript.** Read `node_modules/next/dist/docs/` before
  writing code: v16 has breaking changes (see section 13).
- **Plain CSS**, no Tailwind, no UI library. Three files: `app/tokens.css` (all design values),
  `app/globals.css` (clinic), `app/patient.css` (phone/QR pages), `app/print.css` (A4 print).
- **Database:** Neon Postgres via `@neondatabase/serverless` (HTTP driver, raw SQL, no ORM).
- **Other deps only:** `qrcode` (+ `@types/qrcode`), `bcryptjs`. Fonts via `next/font/google`:
  Inter + Noto Sans Gurmukhi (self-hosted by Next).
- **Icons:** one hand-written inline SVG set in `components/Icon.tsx`; no icon library, no emoji.
- **Hosting:** Vercel, auto-deploy on push to `main`.
- **Env vars** (in `.env.local` and on Vercel; never commit): `DATABASE_URL`, `SESSION_SECRET` (32+ chars).
- `next.config.ts`: `cacheComponents: true`, `partialPrefetching: true`.

## 3. Build in this order

Each phase should end working and deployed.

1. **v1, paper passport:** exercise library, patients, plan wizard, A4 print with QR per exercise,
   stateless QR exercise page `/e/<code>`, evaluation page. Data can start in localStorage.
2. **v2, patient phone + Punjabi:** `/p/<token>` phone passport, en/pa/both languages, exercise
   illustrations, therapist photos, YouTube videos.
3. **v3, real backend:** Postgres, therapist accounts, demo clinic, live phone sync, next-visit date and
   time, visit-period progress, pain 0–10, read-aloud. (In v1 data lived in each browser's localStorage,
   so a patient added on one device was "missing" on another. That was the reason for the database.
   Skip localStorage and start with the database if you prefer.)
4. **v4, animated exercises:** looping animated stick figure for all 12 exercises (teacher's suggestion;
   it replaced YouTube as the main demonstration).
5. **v5, redesign:** design tokens + component system, navy sidebar shell, dashboard, patient list,
   tabbed patient profile, picture-card library, wizard with steppers, refreshed print. Accessibility pass.
6. **Polish:** phone page layout fixes (week-wrapped day strip, readable buttons, labelled pain scale).

## 4. Data model

TypeScript types (`lib/types.ts`):

```ts
type Lang = "en" | "pa" | "both";
type Exercise = { id; name; area; steps: string[]; precautions; videoUrl?; videoSource?;
  pa?: { name; steps: string[]; precautions }; builtin? };
type Patient = { id; code /* P-001 */; initials; age?; condition; language: Lang;
  createdAt /* YYYY-MM-DD */; phoneToken /* 32 hex, secret */ };
type PassportItem = { id; exerciseId; sets; reps; perDay; hold /* "hold 5 s" or "" */;
  precautions; videoUrl; notes };
type Passport = { id; patientId; version; startDate; endDate?; status: "active" | "superseded";
  assessment; setupMinutes; nextVisit? /* "YYYY-MM-DDTHH:mm" local */; items: PassportItem[] };
type LogEntry  = { id /* passportId:itemId:date */; passportId; itemId; date; source: "paper"|"phone"|"therapist" };
type PainEntry = { id /* passportId:date */; passportId; date; score /* 0-10 */; source };
type Review   = { id; patientId; passportId; date; minutes; outcome: "continue"|"modified"|"discharged"; notes };
type Feedback = { id; patientId; passportId; date; ease /* 1-5 */; understood: "yes"|"partly"|"no"; comments };
type Clinic = { therapist; clinic; phone };
type Data = { clinic; exercises /* custom only */; photos: Record<exerciseId, dataUrl[]>;
  patients; passports; logs; pain; reviews; feedback };
```

Rules:
- **One active passport per patient.** Changing the plan creates a new version (v2, v3...); the old one
  becomes `superseded` with an `endDate`.
- **Dates are text** `YYYY-MM-DD`, visit times `YYYY-MM-DDTHH:mm`, no time-zone conversion anywhere.
- **Deterministic ids** for logs and pain so a tick from the phone and the same tick entered in clinic
  become one row, never two.

Postgres schema (`db/schema.sql`, apply with an idempotent `db/migrate.mjs` run as
`node --env-file=.env.local db/migrate.mjs`): tables `therapists` (id, email unique, name,
password_hash, clinic, phone, created_at), `patients` (+ `phone_token` unique), `passports`
(`items` jsonb), `logs`, `pain` (score CHECK 0..10), `reviews`, `feedback`, `exercises` (custom, `data`
jsonb), `photos` (PK therapist_id + exercise_id, `urls` jsonb). **Every table has `therapist_id`**
referencing therapists ON DELETE CASCADE, plus indexes on therapist_id / passport_id.

## 5. How data flows (key architecture decision)

- **Client-shaped store, server data.** The UI edits one in-memory `Data` object through
  `useStore().update(d => ...)` (`lib/store.tsx`). The store diffs old vs new (`lib/diff.ts`) and POSTs
  only changed rows to `/api/sync` in the background (optimistic UI, "Saving... / All changes saved"
  in the sidebar).
- Server (`lib/server/repo.ts`) upserts into typed tables in batched transactions. Every upsert has
  `WHERE table.therapist_id = EXCLUDED.therapist_id` so one account can never overwrite another's rows.
- Store refetches `/api/data` on window focus and every 20 s (skipped while saves are pending), so
  phone ticks appear in the clinic live.
- Client redirects to `/login` on any 401.

API routes:
| Route | Does |
|---|---|
| `POST /api/auth/register`, `/login`, `/logout` | Email + password accounts |
| `POST /api/auth/demo` | Signs into the shared demo clinic (seeds it on first use) |
| `GET /api/data` | `{ me, data }` for the signed-in therapist |
| `POST /api/sync` | Changed rows, upserted / deleted |
| `POST /api/reset` | Reset demo data |
| `GET/POST /api/phone/[token]` | Patient phone view; tick and pain writes |

## 6. Auth

- bcrypt password hash. Session = httpOnly cookie `rp_session` = base64url payload + HMAC-SHA256 with
  `SESSION_SECRET`, 30 days (`lib/server/auth.ts`).
- **Demo clinic:** one shared account `demo@rehab-passport.test` with a random password nobody knows;
  entered only through the "Open demo clinic" button. Seeded from `lib/seed.ts` (3 patients, booked
  visits, paper + phone logs, pain where P-002 has a 7). Anyone can edit it; Clinic settings has
  "Reset demo data". Real accounts start empty.
- Known gaps (fine for a prototype): no password reset, no email verification, no login rate limit.

## 7. Patient links

- **Phone passport `/p/<phoneToken>`**: 32 random hex chars per patient, stable across passport versions.
  The token is the only credential. GET returns a `PhoneView`: code (P-001), language, therapist,
  clinic, phone, active plan items (with photos), ticks, pain, next visit and the visit-period days.
  **Never name or diagnosis.** POST `{type:"tick", itemId, date, done}` or `{type:"pain", date, score|null}`;
  server checks date ≥ passport start and ≤ server today + 1, and that the item belongs to the plan.
- **Exercise QR `/e/<payload>`**: stateless, no database. Payload = base64url JSON
  `{e|n+s, q:[sets,reps,perDay,hold], p?, v?, t?, l?}` (built-in id, or name+steps for custom; dose;
  precautions; video; title; language), defaults omitted to keep the QR small.
- Both pages: server `page.tsx` wrapper that awaits `params`, then a client component.

## 8. Screens

**Clinic (English, sidebar shell: navy sidebar on desktop, top bar + drawer on phones):**
- **Login:** split screen. Left navy panel: "A paper passport for home exercises", Punjabi brand
  "ਰੀਹੈਬ ਪਾਸਪੋਰਟ", the five steps. Right: sign in / create account tabs, "Open demo clinic" button and a
  note that the demo is shared.
- **Dashboard `/`:** date + clinic name, patient search, New patient. 4 figures (active passports,
  average completion 7 days, visits in next 3 days, exercises in library). **Needs attention** (visit
  overdue, or pain ≥7 in last 3 days). **Upcoming visits** (7 days). **Recent activity** (ticks, pain,
  reviews). Top 6 patients table.
- **Patients `/patients`:** search + filters via URL (`?q=`, `?f=attention|pain|overdue|noplan`).
  Shared table component restacks into cards on phones.
- **New patient:** code, initials, age, condition, passport language; generates phoneToken.
- **Patient profile `/patients/[id]`**, tabs via `?tab=`: Overview (alerts, stats, inline next-visit
  datetime input, current plan with per-exercise completion, phone link), Exercise tracking (tick grid
  for the visit period, or whole passport; tap a box to copy a paper tick; pain row; legend: paper/clinic
  vs phone vs pain 7+), Clinical review (form: date, minutes, outcome, notes, next visit; history),
  Feedback (ease 1–5, understood yes/partly/no, comments), Passport history (versions, delete patient).
  Header actions: Phone view, Copy phone link, Print passport, Adjust plan. Toasts on save.
- **Plan wizard `/patients/[id]/plan`** (4 steps, sticky footer with "n exercises selected / Next"):
  1 Assess (assessment summary + pick exercises from picture cards with area chips),
  2 Personalize (sets / reps / times a day steppers, hold, precautions, notes per exercise),
  3 Demonstrate (QR + animation preview, optional video link),
  4 Confirm (next visit date and time, clinician minutes). Saves a new passport version.
- **Print `/patients/[id]/print`:** A4, in the patient's language, mm units. Cover: brand, patient code,
  therapist, clinic, plan version + start, next visit date + time, "how to use your passport" (Do, Tick,
  Watch, Bring), STOP box, phone QR. Then one block per exercise: two-frame drawing or therapist photos,
  steps, dose box, precautions, QR to its `/e/` page, tick grid for the visit period (7–28 days, wraps at
  14 columns), clinician-review line. Then a daily pain sheet (0–10 colour scale) and a feedback page.
- **Library `/library`:** picture cards (two frames side by side), search in English or Punjabi, area
  chips. Side panel shows the selected exercise (animation, steps en + pa, precautions, therapist photos
  up to 3, resized to 640px JPEG data URLs, delete) or an "Add custom exercise" form.
- **Evaluation `/evaluation`:** feasibility figures (exercise-log completion, patient usability 1–5,
  understood instructions %, clinician minutes new/review), completion by passport (table) and by
  exercise (bars), "Safety monitoring and channel use" (pain first-3 vs last-3 average, reports of 7+,
  % of ticks from phone), CSV and JSON export.
- **Clinic settings `/settings`:** therapist name, clinic, phone (printed on passports; warn if it is still
  a placeholder); Reset demo data.
- **About `/about`:** how it works, privacy.

**Patient phone `/p/<token>`** (18px body, 56px main buttons, max width 640px):
- Navy band: brand + code, language switch (ਪੰਜਾਬੀ / ਦੋਵੇਂ Both / English, remembered in
  localStorage), "Today" and the date in the chosen language (own Punjabi month/day names).
- Visit card: next visit date + time, days left (or "visit today" / overdue in orange), progress bar
  "Exercises done since your last visit 24 / 33 · 73%", day strip for the visit period **wrapped 7 per
  row** (full, partial, missed, future dashed, today ringed, visit day with calendar icon).
- One card per exercise: small drawing, name, dose, big **Mark done** toggle and **Show steps** (opens
  the animated figure, steps, read-aloud, video, precautions).
- "All done for today" banner. Pain 0–10 buttons (green 0–3, yellow 4–6, red 7–10), ends labelled
  "0 No pain" and "10 Worst"; 7+ shows a stop warning. Call therapist button. STOP box. Footer.
- Offline / failed save: undo the optimistic change and show an error line.

**Visit period** (`visitPeriod()` in `lib/logic.ts`): from the last review of this passport version (or
its start) to `passport.nextVisit` (fallback +14 days), capped at 42 days. It drives the profile grid,
completion %, the phone countdown/strip/progress and the printed tick grid.

## 9. Content

- **12 built-in exercises**, each with English + Punjabi name, 3 steps, precautions ending in the
  standard STOP sentence, and a verified embeddable YouTube video with channel credit:
  | id | Name | Area | Punjabi |
  |---|---|---|---|
  | sit-to-stand | Sit-to-stand | Lower limb | ਬੈਠ ਕੇ ਖੜ੍ਹੇ ਹੋਣਾ |
  | heel-raises | Heel raises | Lower limb | ਅੱਡੀਆਂ ਚੁੱਕਣਾ |
  | straight-leg-raise | Straight leg raise | Lower limb | ਸਿੱਧੀ ਲੱਤ ਚੁੱਕਣਾ |
  | quad-sets | Static quadriceps | Lower limb | ਪੱਟ ਦੀ ਮਾਸਪੇਸ਼ੀ ਕੱਸਣਾ |
  | ankle-pumps | Ankle pumps | Lower limb | ਗਿੱਟੇ ਉੱਪਰ-ਹੇਠਾਂ ਕਰਨਾ |
  | bridging | Bridging | Hip & back | ਬ੍ਰਿਜ (ਕੁੱਲ੍ਹੇ ਚੁੱਕਣਾ) |
  | clamshell | Clamshell | Hip & back | ਕਲੈਮਸ਼ੈੱਲ (ਪਾਸੇ ਲੇਟ ਕੇ ਗੋਡਾ ਖੋਲ੍ਹਣਾ) |
  | pelvic-tilt | Pelvic tilt | Hip & back | ਪੇਡੂ ਝੁਕਾਉਣਾ (ਪੈਲਵਿਕ ਟਿਲਟ) |
  | pendulum | Shoulder pendulum | Upper limb | ਮੋਢੇ ਦੀ ਪੈਂਡੂਲਮ ਕਸਰਤ |
  | wall-slides | Wall slides | Upper limb | ਕੰਧ 'ਤੇ ਹੱਥ ਸਰਕਾਉਣਾ |
  | chin-tucks | Chin tucks | Neck | ਠੋਡੀ ਪਿੱਛੇ ਖਿੱਚਣਾ |
  | seated-march | Seated marching | Balance & mobility | ਬੈਠ ਕੇ ਕਦਮ-ਤਾਲ |
- **Standard STOP text:** "STOP and contact your therapist if you feel sharp or worsening pain,
  dizziness, chest pain, breathlessness or new swelling. In an emergency, call your local emergency number."
- **Patient-facing strings** live in `lib/i18n.ts` (en + pa dictionaries; keys include brand, howTo,
  how1–4, stopTitle, stopBody, painToday, painNone, painWorst, painHigh, nextVisitIn, daysLeft,
  visitToday, overdue, periodProgress, markDone, done, showSteps, hideSteps, allDone, callTherapist,
  listen, rep, phStart/phMove/phHold/phReturn, offline, badLink...). Clinic screens stay English only.
  `<T lang k>` and `<Pair>` (`components/Bi.tsx`) render "both" as Punjabi with English underneath.
- **Punjabi has not been checked by a native speaker or a physio.** Keep a `PUNJABI_REVIEW.md` listing
  what needs checking, safety text first (stopTitle, stopBody, painHigh, precautions).

## 10. Exercise visuals

- **Drawings:** `lib/figures.ts` holds pose data (joints + props such as chair, bed, wall) per exercise,
  two frames (start, end) with arrows. `components/Figure.tsx` renders SVG; `frame={0|1}` for one frame.
- **Animation:** `lib/animation.ts` blends the two poses by **joint angle** (limbs keep their length),
  pinned joints by position, planted feet with two-bone IK. Per-exercise motion: sit-to-stand and
  bridging `plant`, pendulum `swing`, seated-march `alternate`. Timeline per rep: start 0.6 s → move
  1.4 s → hold (item hold, 0.5–5 s) → return 1.4 s; end-frame arrows fade in.
  `components/AnimatedFigure.tsx` (requestAnimationFrame): "Rep n / reps", phase label, Slower (×1.7),
  Pause/Play; starts paused under reduced motion. Works offline once loaded.
- **Therapist photos** (max 3 per exercise) replace the drawing on print and phone.
- **Videos:** YouTube embed shown below the animation as "Video of a real person".
- **Read-aloud:** `components/Listen.tsx` uses `speechSynthesis`; Punjabi voice if the phone has one,
  else English (en-IN) with a note.

## 11. Design system

- **Brand:** navy `#101D35`, blue `#193C56`, teal `#159E91` (accents only), **`#0D776D` for teal text
  and filled buttons** (white on `#159E91` is only 3.3:1), mint `#E8F4F1`, page `#F5F7FA`.
  States: warn `#B54708`, danger `#B42318`, ok `#1E6B3A`, each with a soft tint.
- **All colours, sizes, spacing, radius, shadows and motion live in `app/tokens.css`.** Components never
  use literal values.
- Type: Inter + Noto Sans Gurmukhi, scale ratio 1.2 from 15px (clinic body), patient body 18px.
  Spacing 4px scale. Radius 8 (controls), 12 (cards), 16 (big). Controls 40px tall, 44px hit area;
  patient main buttons 56px.
- Motion is state only (transform/opacity, 120–220 ms), all off under `prefers-reduced-motion`.
- Accessibility: AA contrast, visible focus rings, icons always beside a text label, keyboard paths,
  `aria-pressed` on toggles, `role="alert"` for safety messages.
- Light theme only (clinic + print use).

## 12. Deploy

1. Create the GitHub repo and a Neon project (Postgres). Run the migrate script.
2. Create the Vercel project **in the same Vercel account that will own it long-term**, connected to
   that repo, and add `DATABASE_URL` and `SESSION_SECRET` for Production.
3. Push to `main` → Vercel deploys.

## 13. Lessons learned (avoid these)

- **One repo, one Vercel project, one owner.** Last time the site deployed from `proudstone-576`'s
  repo while work was pushed to `simar2302`'s; two repos never sync on their own, and being GitHub
  collaborators does not change that. On Vercel's free (Hobby) plan, commits by anyone other than the
  owner to a private repo get "Deployment blocked".
- **Name the new repo something other than `rehab-passport`** if a Claude cloud session ever needs both
  the old and the new repo: two repos with the same name cannot be in one session.
- **Next.js 16:** dynamic routes need a server `page.tsx` that does `await params`, plus
  `export const instant = false`; route handlers use `RouteContext<"/api/...">`; the lint rules forbid
  `setState` inside effects (disable per line where intended) and `Date.now()` during render.
  Install the latest 16.x patch (`next build` flagged 16.4.3 for a security issue; 16.4.6 existed).
- **Don't use localStorage for clinic data** (it is per browser). Use it only for small per-device
  preferences, like the patient's language choice.
- **Check screens without a database:** build with dummy env vars, run `next start`, and use Playwright
  to mock `/api/data`, `/api/sync` and `/api/phone/*` with data from `lib/seed.ts`. Screenshot desktop
  1440px and phone 390px.
- Only `fmtDate` omits the year for current-year dates; printed passports always show the full date.

## 14. Copy, don't rewrite

These files are hand-made content that took real time to get right. Copy them from
`github.com/simar2302/rehab-passport` into the new repo rather than asking a chat to regenerate them:

- `lib/exercises.ts`: 12 exercises, English + Punjabi text, verified videos.
- `lib/i18n.ts`: all patient-facing English + Punjabi strings and Punjabi date names.
- `lib/figures.ts`, `lib/animation.ts`, `components/Figure.tsx`, `components/AnimatedFigure.tsx`:
  drawing poses and animation.
- `app/tokens.css`: the design tokens.
- `db/schema.sql`, `lib/seed.ts`: schema and demo data.
- `PUNJABI_REVIEW.md`.

**Fastest option of all:** if the goal is just a fresh repo you own, copy the whole repo (GitHub → Use
this template / import, or push the code to the new repo) and keep going. The rebuild is only worth it
if you want to redo the code itself.

## 15. Still open

- Native Punjabi speaker + physiotherapist to proof-read Punjabi (safety text first).
- Optional: record own Punjabi demo videos.
- Offline mode / PWA (only if asked).
- Ideas: SMS/WhatsApp visit reminders, Hindi, large-print mode, offline queue for phone ticks,
  password reset, login rate limiting, photos in blob storage instead of the database.
