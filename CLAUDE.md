# Consulting Employee Portal — Project Rules

Stack: GitHub → Azure Static Web Apps (Gov). Azure Functions (C#/.NET) API layer.
Azure Database for PostgreSQL (Gov) backend. Entra ID (Azure AD Gov) for auth.
Azure Blob Storage (Gov) for files. No frontend frameworks, no build step —
plain multi-file HTML/CSS/JS served directly.

Cloud tier: Azure Government GCC (standard). Stay upgrade-compatible with GCC
High — keep audit logging structured from day one, avoid non-US-persons-only
assumptions in admin workflows, keep network/isolation boundaries configurable
rather than hardcoded.

File structure:
- index.html — shell only: nav markup, screen containers, link/script tags
- styles.css — all styling
- app-core.js — session handling, logout, isAdmin, shared utils, screen router
- screen-auth.js — login
- screen-profile.js — profile, resume, assets
- screen-directory.js — roster, org chart
- screen-timekeeping.js — current, history, PTO
- screen-travel.js — Travel Request (New), existing subpage
- screen-travel-estimate.js — Travel Estimate (new)
- screen-travel-expense.js — Travel Expense Report (new, built after Estimate)
- screen-training.js
- screen-myteam.js — supervisor view, reuses base screen functions with role/scope param
- screen-admin.js — admin view, reuses base screen functions with role/scope param
- Load order in index.html: app-core.js first, then screen files
- screen-myteam.js/screen-admin.js must reuse shared render/data functions from
  their base screen files (scoped via role/scope param) — no duplicated logic

Design: read the frontend-design skill/reference before any UI code. Dark mode,
teal accent #2AB8A6, design tokens locked at session 1, never deviated from.

Accessibility: WCAG 2.0 AA / Section 508. Light/dark mode user-selectable in
app settings, default to dark.

Critical rule: never full-rewrite any file. Always read the current file first,
then make surgical patches only. Patch notes must specify which file(s) changed.

Auth: Entra ID Gov session/role handling. Treat as highest-risk build step.

Data layer: Postgres RLS policies required before go-live in any environment
with live data, written against Entra ID JWT claims. Demo/dev environments
using Supabase with no live data may defer RLS — confirm status per table
before assuming it's on.

Developer profile: experienced Power Apps citizen developer, limited web/
software dev background. Explain decisions, flag risks, suggest better
patterns when they exist. No unexplained jargon.

Standing guardrails:
- Flag instability, security gaps, and maintenance traps before building
- Auth and credential handling get extra scrutiny
- Scope creep that bloats any single file gets called out
- Give patch notes for every new/changed file, for GitHub commit messages

Session discipline:
- Confirm build scope at session start before any code is written
- Backlog-driven; nothing built without explicit approval
- Data model and screen architecture approved before any code
- Sessions close with a written summary + next-session prompt

Discovery mode: when a message is discussion/brainstorming/"what if" rather
than a build/patch request, these rules are background context, not gates —
engage freely without invoking approval gates or build sequencing. Session
discipline applies again the moment it turns into an actual build/patch request.

Build sequencing: Auth shell → highest-daily-use screens → supporting screens
→ dashboard last.

Patch notes format: every patch-notes block in a fenced code block:
- Line 1: short summary (commit-message style, imperative mood)
- Blank line
- Bulleted list of specific changes
- Blank line (if applicable)
- Any verification/integrity checks performed
No prose outside the code block except a one-line intro if needed.

SSP Logging (NIST 800-171): log any decision touching auth/identity,
role/permission logic, logging/audit trails, encryption/storage/transmission,
backup/patching/config, or incident handling into ssp-log.md with: date,
control family + number if known, plain description of what was implemented,
status (Implemented/Planned/N/A), and any gap/follow-up. Don't pause the build
to write formal SSP language — capture raw facts as they happen.
