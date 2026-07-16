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

## 2026-07-16 — Travel Expense Report: audit trail + storage bucket (AU-2/AU-3, SC-28)
New `travel_expenses`, `travel_expense_receipts`, `travel_expense_audit_log`
tables (user-run SQL, this session). Field-level audit logging mirrors the
Travel Estimate pattern: every create/edit/submit writes a row to
`travel_expense_audit_log` via `texDiffFields()`. Receipts are stored in a
new public Supabase Storage bucket `travel-receipts`, simulating the future
Azure Blob Storage migration, with a permissive "any authenticated user can
insert/select" policy — accepted risk for the no-live-data POC, same stance
as the rest of the data layer.
Status: Implemented (client-side, Supabase POC).
Gap/follow-up:
- Storage bucket policy is intentionally permissive (any authenticated user
  can read/write any object in the bucket, not just their own receipts) —
  must be tightened to per-user/per-report scoping before go-live.
- Only `draft` reports are editable in the UI; not enforced by RLS (same
  gap as travel_estimates).
- Submitting an expense report sets the linked `travel_estimates.status` to
  `expensed` — this is a client-side write, not a DB trigger, so it's only
  as reliable as the app's error handling; a failed follow-up write would
  leave the two tables inconsistent. Worth a DB trigger before go-live.
- Two-stage approval fields (`supervisor_status`, `principal_status`) exist
  on the table but no approval-review UI is built yet — deferred to a
  follow-up session per user's explicit call, same as the Travel Estimate
  approval workflow.

## 2026-07-16 — Travel Estimate + Expense approval-review UI (AC-3, AU-2/AU-3)
Built the deferred My Team / Admin approval screens for both Travel
Estimate and Travel Expense Report, nested as new subtabs under each
role's existing Travel tab (Travel Requests / Travel Estimates / Travel
Expense Reports). Also discovered and fixed a pre-existing gap: Admin's
Travel tab was still a static "Coming next session" placeholder — the
`switchAdminSubtab()` router already called `loadTeamTravel('admin')` but
the container it targeted was never built, so Admin could never actually
review travel_requests either.

Travel Estimate approval (screen-travel-estimate.js): single-stage, since
`travel_estimates` has only one `approved_by`/`approved_at` slot. My Team
(the employee's manager chain, via `getRecursiveReportIds`) gets
Approve/Return/Deny; Admin sees the identical data read-only (no action
buttons) to avoid two roles racing to decide the same field. This is an
assumption, not a confirmed business rule — logged in coa_travel_backlog
memory to check with the client (who should approve Estimates was never
explicitly stated, unlike Expense Reports where the chain was given).
Every decision writes to `travel_estimate_audit_log`.

Travel Expense approval (screen-travel-expense.js): two-stage per the
chain the user gave (supervisor then principal). My Team decides
`supervisor_status` first; approving there doesn't change
`current_status` (report stays `submitted`, now visible in Admin's
queue) — denying/returning is terminal immediately. Admin then decides
`principal_status`; approving is terminal (`current_status` → `paid`)
and also flips the linked `travel_estimates.status` to `paid` (the
intended purpose of that estimate status). Every decision writes to
`travel_expense_audit_log`.

Status: Implemented at UI level only (both).
Gap/follow-up:
- Not enforced by RLS — a direct API call could set `approved_by`/
  `supervisor_status`/`principal_status` on any row regardless of actual
  role or team membership in the current Supabase POC (no live data,
  accepted risk). Must be enforced via Postgres RLS against the Entra ID
  JWT role/manager-chain claims before go-live.
- Who approves Travel Estimates (My Team only vs. also Admin) is an
  assumption pending client confirmation — see coa_travel_backlog memory.
- "Principal" is a label only, not a distinct role/permission in the
  app — anyone who can reach the Admin screen (`isAdmin()` gate) can act
  as principal. If the client wants a narrower "Principal" role distinct
  from general Admin, that needs its own role/permission work.
