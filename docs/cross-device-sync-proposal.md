# Proposal: accounts and cross-device sync

This is a proposal, not a plan I've started building. Nothing in this document has been
implemented. It exists to answer one question from the improvement pass: what would it take to
let a notebook follow you from a laptop to a phone, and is that worth doing now?

## Why this is separate from the current Java server

The full-stack local edition (`ApplicationServer` + `ApplicationRepository`) already has an HTTP
API and a persistence layer, so the tempting shortcut is "just point the public website at that
server instead of the browser." **Don't do that.** That server has:

- no accounts, so every visitor would read and write the same one notebook
- no per-user data isolation - the storage layer has no concept of "whose" application a row is
- no authentication on any endpoint - `PATCH /api/applications/{id}` will update ID 1 for anyone
  who asks
- no production hardening (rate limiting, CSRF protection, TLS termination, input size limits at
  the transport level) - it was built to run on `localhost` for one person

Exposing it publicly as a shared backend today would mean every visitor's applications are
readable and editable by every other visitor. This proposal is about building the accounts and
isolation layer first, not about turning the switch on early.

## What "sync" should mean here

A student's internship notebook is personal, small (dozens to a few hundred entries, not
thousands), and edited in short bursts from one device at a time in the common case. That shapes
the design:

- **Not real-time collaboration.** Nobody needs to see someone else typing in their own notebook.
  A "last write wins with a visible conflict warning" model is enough; a CRDT or operational-
  transform layer would be solving a problem this product doesn't have.
- **Occasionally connected is fine.** A phone on the subway with no signal should still let you
  open a page, edit it, and have it catch up once it's back online - which is exactly what the
  local-first, drafts-and-retry architecture already built in this pass gives us for free. Sync
  extends that same queue to a second destination (the server) instead of replacing it.
- **The browser copy stays the source of truth for "did my edit take" right now.** The server
  becomes the thing that reconciles *between* devices, on its own schedule, not the thing the UI
  waits on for every keystroke.

## Proposed architecture

```text
Browser A (local-first: IndexedDB/localStorage + the existing drafts/retry queue)
   |  background sync (batched, debounced, retried - same shape as today's autosave)
   v
Sync API  ──  Auth  ──  Postgres (per-user tables, row-level ownership)
   ^
   |  background sync
Browser B
```

### Accounts and auth
- Email + magic link (passwordless) as the default: no password database to protect, and it
  matches the target user (a student who wants "sign in on my phone too," not enterprise SSO).
  Add an OAuth option (Google/GitHub) later if requested - both can sit behind the same user
  table.
- Sessions via short-lived signed cookies (HttpOnly, Secure, SameSite=Lax) issued after the
  magic-link click, refreshed on use. No JWTs stored client-side for this use case; there is no
  need for stateless tokens across services here.

### Data model
- Every table gains a `user_id` foreign key and every query is scoped by it at the repository
  layer (never trust a client-supplied ID alone - re-derive "whose row is this" from the
  authenticated session on every read and write).
- Add `updated_at` (already exists) plus a monotonic `version` integer per application, bumped on
  every write, to support the conflict rule below without needing vector clocks.
- Soft-delete (already the Recently Deleted model) extends naturally: it's already
  device-agnostic once it's server-backed.

### Sync protocol
- A device pushes its locally-queued changes (the same drafts structure this pass introduced)
  to `POST /api/sync` in a batch, each change carrying the `id` and the `version` it was based on.
- The server applies each change if the incoming `version` matches what it has; if it doesn't
  (another device changed the same application first), the change is rejected with the server's
  current copy attached, and the client shows both versions with a "keep mine / keep theirs / view
  both" choice rather than guessing. Given how rarely the same application will be edited from two
  places within the same minute, this should be a rare prompt in practice, not a routine one.
- A device pulls everything with `updated_at` newer than its last successful sync on
  reconnect/app-open, merges it locally, and continues using the browser copy immediately - no
  loading spinner blocking the UI while sync runs in the background.
- The existing `history` (status-change timeline) already gives a natural audit trail to fall back
  on if a merge ever looks wrong.

### Rollout, kept small
1. **Read-only sync first**: pull-only, so a second device becomes a live *view* of your notebook
   with no write-conflict risk at all. Ships the account/auth/API plumbing and proves the pull
   side before the harder push/merge side exists.
2. **Push with the version-conflict rule above.**
3. **Migration path for existing local-only users**: "Create an account" on the website offers to
   upload the current browser backup as the starting point for the account, using the same
   validated import path this pass already built (so a corrupted or malicious backup still can't
   poison a new account).

## What this costs

- A real server (not `localhost`): a small managed Postgres instance and an API process, which is
  the first ongoing hosting cost this project would take on (the current GitHub Pages + browser-
  storage model has none).
- Auth email delivery (a transactional email provider).
- Meaningfully more surface area to keep secure: this is the point where "reviewed by a second
  set of eyes before shipping" starts to matter, especially around session handling and the
  per-user data scoping.

## What I'd want confirmed before starting

- Whether "sync" should extend the existing Java server (Spring Boot migration, per the README's
  "Next upgrades") or a new small service - the accounts/versioning design above doesn't depend on
  which.
- Hosting budget and provider preference (Postgres + a small compute instance is the likely
  shape).
- Whether passwordless email is acceptable, or an OAuth-only ("Sign in with Google") flow is
  preferred instead to skip building email delivery at all.
