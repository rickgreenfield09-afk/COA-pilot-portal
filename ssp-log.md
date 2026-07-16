# SSP Log (NIST 800-171 raw facts)

## 2026-07-15 — Travel Estimate audit trail (AU-3 / AU-2)
Implemented field-level audit logging for `travel_estimates` writes: every
create/edit/submit writes a row to `travel_estimate_audit_log` with
`changed_by`, `changed_at`, `action` (edit/status_change), `field_changes`
(jsonb before/after diff via `teDiffFields`), `previous_status`, `new_status`.
Status: Implemented (client-side write, Supabase POC — no RLS yet).
Gap/follow-up: not yet enforced at the DB level; a client that skips the app
UI could write to `travel_estimates` without a corresponding audit row until
Postgres RLS/triggers are in place on Azure. Approval-action audit entries
(manager/admin approve-return-deny) are not yet implemented — deferred with
the approval-workflow UI itself.

## 2026-07-15 — Travel Estimate edit lock (AC-3)
Once an estimate's `status` is `submitted`/`approved`/`expensed`/`paid`, the
employee-facing screen renders a read-only detail view instead of the edit
form — only `draft` rows show the editable form.
Status: Implemented at UI level only. Gap/follow-up: not enforced by RLS —
a direct API call could still edit a non-draft row in the current Supabase
POC (no live data, accepted risk). Must be enforced via Postgres RLS policy
before go-live per CLAUDE.md data-layer rule.

## 2026-07-16 — Profile field edit gate (AC-3)
Fixed a bug found live on the Vercel POC deploy: `renderProfile()` referenced
`adminEditableFields`/`employeeEditableFields` (screen-profile.js) which were
never declared anywhere in the codebase, throwing a ReferenceError and
breaking the entire My Profile > Overview screen. Declared both lists in
app-core.js. Split confirmed with user: contact info (preferred name, phone,
home email/phone, known traveler number) is employee self-service editable;
org placement (department, location), HR status (start date, employment
status), and security clearance fields are admin-only.
Status: Implemented at UI level (isEditable() gate in renderProfile()).
Gap/follow-up: not enforced by RLS or a server-side check — a direct API
call could still PATCH an admin-only field on someone else's profile in the
current Supabase POC (no live data, accepted risk). Must be enforced via
Postgres RLS policy against the Entra ID JWT role claim before go-live.

## 2026-07-16 — Directory roster/org chart cache bug (bug fix, no control impact)
`dirFetchAllProfiles()` (screen-directory.js) referenced `dirAllProfiles`
without ever declaring it, throwing a ReferenceError and breaking both
Directory subtabs. Declared `var dirAllProfiles = []` in screen-directory.js.
No access-control implications — this is a plain missing-variable bug from
the original monolith-to-multi-file split, not a permission decision.

## 2026-07-16 — Customer/Prime copy gated on approval status (AC-3)
Redesigned the Travel Estimate Internal/Customer toggle after user review:
originally it was a free-toggle on the live draft-edit form, which would
have let anyone preview marked-up customer figures before a manager
approved the underlying estimate. Removed the toggle from the edit form
entirely (Internal-only while draft/submitted). Added a "Generate
Customer/Prime Copy" action to the read-only detail view, gated to only
appear when `status` is `approved`/`expensed`/`paid`. Recomputes the
markup view from the stored internal totals + snapshotted
`fee_multiplier_used` — view/print only, never written back to the row.
Status: Implemented at UI level only.
Gap/follow-up: who may trigger the Customer/Prime copy is intentionally
unrestricted for now (any viewer of the estimate, not just the approving
manager/admin) per user's explicit call 2026-07-16 — flagged to confirm
this whole flow concept with the client before it's relied on. Also not
enforced server-side: a direct API read of `travel_estimates` still
exposes the raw fields regardless of status in the current Supabase POC
(no live data, accepted risk).
