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

## 2026-07-16 — Admin given full approve/return/deny power on Travel Estimates (AC-3, supersedes prior entry)
User clarified: Admin is a deliberately small role (2-3 people — the
principal, the main Admin, and the user for testing/troubleshooting) with
"superpower over everything." Changed `renderTeamEstimateDetail()` /
`loadTeamTravelEstimates()` (screen-travel-estimate.js) so Admin now gets
the same Approve/Return/Deny actions on Travel Estimates that My Team has,
instead of the read-only oversight view from the earlier entry. Both
scopes can independently decide the same `approved_by`/`approved_at`
field — accepted as a low-probability race given the very small number of
Admin accounts, not something worth blocking on for this POC.
Status: Implemented at UI level only. Same RLS gap as noted above applies.

## 2026-07-16 — Dashboard: pending-approval counts + Upcoming Travel wired to real data (no control impact)
Found and fixed a pre-existing display bug the user hit while testing:
after approving a Travel Estimate, it appeared to "disappear" because the
Dashboard's "Upcoming Travel" card (My Dashboard, My Team, and Admin) was
a static "Coming soon" placeholder that had never been wired to any
table — not a bug in the approval write path itself, and not date-gated
as the user suspected. Added `buildUpcomingTravelHtml()` (screen-travel.js,
shared) which lists approved `travel_estimates` + approved
`travel_requests` with a future date, and wired it into all three
dashboards. Also added `travelPendingSummaryHtml()` (screen-travel.js,
shared) so the existing "Pending Requests" dashboard card (which already
listed Time Cards/PTO counts) now also surfaces Travel Requests/Estimates/
Expense Reports awaiting approval, with a Review link that jumps straight
to the right nested subtab. No access-control implications — purely a
missing-query / stale-placeholder fix, not a permission change.

## 2026-07-16 — Expand-to-full-cost-breakdown on approval review (no control impact)
Added a "Show Full Cost Breakdown" toggle (`toggleDetailBreakdown()`,
screen-travel.js, shared) to both the Travel Estimate and Travel Expense
Report team-review detail cards, so an approver can see the underlying
line items (per diem rates, airfare, lodging, EWW hours, etc.) before
deciding, not just the rolled-up totals. Purely additive display — no
access-control implications.

## 2026-07-16 — Collapsed redundant supervisor+principal approval on Expense Reports (AC-3)
User flagged a real workflow problem while testing: in this org, the
Principal approver is the same person as the employee's direct
Supervisor, so the two-stage chain made him approve the identical report
twice — once under My Team, once under Admin — for no reason.
`teamExpenseAction()` (screen-travel-expense.js) now detects when the
actor is viewing as `myteam` (i.e., is the report's supervisor by
definition of the recursive-reports scope) AND also holds the Admin role
(`isAdmin()`); if so, a single Approve sets both `supervisor_status` and
`principal_status` to `approved` and finalizes `current_status` in one
write, instead of requiring a second visit to the Admin screen. A note is
shown in the review card when this collapse will happen, so it isn't a
silent behavior change. Deny/Return are NOT collapsed — either stage can
still independently stop the report regardless of the actor's other
roles, since a return/deny is meant to halt progress, not skip it.
Status: Implemented at UI level only. Same RLS gap as other approval
actions — not enforced server-side yet.

## 2026-07-16 — Date-display timezone bug found and fixed (no control impact, correctness)
`formatDate()` (app-core.js) parsed plain `YYYY-MM-DD` strings via
`new Date(d)`, which JS parses as UTC midnight — `.toLocaleDateString()`
then converts to the browser's local timezone, so anyone west of UTC saw
every date-only field rendered one calendar day earlier than what's
actually stored (confirmed live: a trip entered as Aug 10–14 displayed as
Aug 9–13). This affected every date-only column shown anywhere in the
app — Timekeeping, PTO, Travel Requests/Estimates/Expenses, Directory
start dates, clearance dates, etc. — not just Travel. Fixed by parsing
`YYYY-MM-DD` strings as local calendar components (year/month/day)
instead of routing them through UTC. Timestamp strings (with a time
component) are unaffected and still parse via the original path.
Status: Implemented, fixes display only — the underlying stored dates
were never wrong, only how they rendered.

## 2026-07-16 — BACKLOG: expense-report terminal status should be "approved," not "paid" (planning note, no code change)
User flagged: once Principal approval clears, the pill currently shows
`paid` (both `travel_expenses.current_status` and the linked
`travel_estimates.status`), but the real-world process needs an
intermediate `approved` state — `paid` should only be set by a separate,
explicit Admin action ("mark as sent in this payroll run"), decoupled
from the approval decision itself. Per user's explicit instruction, this
is a backlog note only — no code changed. User also noted the
timekeeping/payroll module has a chunk of work still ahead of it before
shipping data to the 3rd-party payroll processor's API, and this
"mark as paid" mechanism likely belongs alongside that effort rather than
as a standalone toggle. See coa_travel_backlog memory.
