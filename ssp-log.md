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

## 2026-08-07 — Profile field edit gate correction (AC-3)
Corrected the 2026-07-16 split: `adminEditableFields` was being applied to
the My Profile (self-edit) screen, meaning an admin viewing their own
profile could edit their own job title, start date, employment status, and
clearance fields — no separation of duties, since there is no separate
admin-edits-another-employee screen yet. Moved job_title, start_date,
employment_status, clearance_level, clearance_investigation_type,
clearance_granted_date, and clearance_expiration_date out of both editable
lists — display-only for everyone on this screen, including admins, until
a proper other-employee admin edit screen exists. Also fixed a second bug:
`bio` had an isEditable() input path in renderProfile() but was never in
either editable list, so no one could actually edit it — added `bio` to
employeeEditableFields (self-service, same as contact info).
Status: Implemented at UI level (isEditable() gate in renderProfile()).
Gap/follow-up: same as 2026-07-16 entry — not enforced by RLS or a
server-side check yet; must be enforced via Postgres RLS policy against
the Entra ID JWT role claim before go-live. Re-enable HR/clearance
self-view-only fields for admin editing only once a dedicated
admin-edits-another-employee screen exists that operates on someone else's
profile row, not the logged-in admin's own.

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

## 2026-07-16 — Corrected calc formulas against source-of-truth spreadsheet (correctness, financial)
User provided the client's actual Excel template
(CyberOffset_Travel_estimate_V26.0, "To Prime"/"COA Internal" tabs) and
confirmed it is the source of truth for these calculations, correcting
two prior assumptions:
1. "Travel Days" per diem is 1.5x M&IE **once**, not once per departure
   day AND return day. An earlier session had confirmed "both ends" —
   that was wrong; the spreadsheet formula (`D15=G7*1.5`) is authoritative.
2. Only Airfare, Airport Parking/Transport, Baggage, Per Diem, and Hotel
   are multiplied by Number of Trainers (the "per-traveler" bucket).
   Rental Car/Gas/Parking/Tolls, Mileage, and Shipping To/Back are
   trip-level costs added once regardless of headcount (the spreadsheet's
   separate "Trip lead total" group, `D25:D29`) — previously Rental Car
   and Mileage were wrongly included in the per-traveler (multiplied)
   bucket in both `teCalc()` (screen-travel-estimate.js) and `texCalc()`
   (screen-travel-expense.js).
Fixed both functions to match. Verified via direct JS execution against a
test scenario (4 nights, 2 trainers) — Internal grand total moved from an
incorrectly-inflated $4,406.00 to a correct $3,942.00; Customer/Prime
grand total to ≈$4,274.51.
Status: Implemented. This affects every Estimate/Expense total computed
before this date — historical rows already submitted/approved before this
fix carry the old (incorrect) stored totals and were not retroactively
recalculated (no request to do so; flag if COA wants existing test rows
corrected or discarded).

## 2026-07-16 — EWW shown as a real dollar total on Customer/Prime copy (BACKLOG: verify with client)
The source spreadsheet's "To Prime" tab has a mini-summary box that
references a blank cell (`D38`) instead of the actual EWW total cell
(`D39`), so it always displays $0 for EWW there — while still showing the
raw EWW hours elsewhere on the same sheet. Could be intentional (hide the
EWW dollar figure from the customer-facing copy) or a leftover template
bug. Per user's explicit call, the app's Customer/Prime copy will
continue showing the real computed EWW dollar total (unchanged from
current behavior) rather than matching the spreadsheet's apparent
suppression. Flagged in coa_travel_backlog memory to confirm with the
client which behavior they actually want.

## 2026-07-20 — Timekeeping rebuilt: weekly Time Code matrix + DCAA audit log (AU-2/AU-3, AC-3)
Replaced the biweekly start/stop-time timekeeping model with a weekly
Time Code x Mon-Sun matrix per user direction: dropped `day_start`/`day_end`
and the "Now" fill buttons entirely; time is entered directly in 0.5-hour
increments (dropdown, no loose minutes); periods changed from 14-day pay
periods to Monday-Sunday weeks (`TK_WEEK_ANCHOR` = Mon 1/5/2026 = Week 1,
same "first full week entirely in January" convention the old biweekly
scheme used for Period 1). Approval/return flows (`teamTkApproveAll`/
`teamTkSubmitReturn`, screen-timekeeping.js) carry over unchanged in
substance, just re-pointed at weekly bounds; the per-day Flag toggle moved
to a day-COLUMN toggle since rows are now Time Codes, not days.

New `time_codes` table replaces `projects`/earning_type as the thing
selected per row (labor category / customer / CLIN-SLIN / indirect, e.g.
Bid & Proposal, Business Development, Holiday, Vacation). `earning_type`
is kept on `time_entries`, now populated only for billable
(gov_contract/commercial_customer) rows, system-computed regular-vs-
overtime past 40 billable hrs/week — indirect codes never generate OT.

New `time_card_audit_log` table (DCAA compliance): every submit/edit/
approve/return writes a row via `tkLogAudit()` (screen-timekeeping.js) —
employee, week, time code, action, field/old/new value, performed_by/at,
reason. Append-only from the app's side; no UPDATE/DELETE should ever be
granted on this table at the DB level.

Vacation/PTO integration (explicit design discussion with user before
building): Vacation is a normal, selectable Time Code, but linked to the
existing PTO Request/Balance system — entering Vacation hours on a date
with no covering pending/approved PTO request blocks that cell's save and
prompts an inline single-date PTO request (`submitInlinePtoRequest`) with
editable hours. Per user's explicit calls: (1) PTO requests now support a
custom "Hours per day" (previously hardcoded to 8), (2) pending Vacation
entries count toward the day/week total until denied, (3) requests that
would put the PTO balance negative are still allowed via "Submit Anyway" —
no hard block — pending an actual policy answer from the team.

Status: Implemented at UI level only (client-side Supabase POC, no RLS).
Gap/follow-up:
- Requires user-run Supabase SQL (provided to user, not committed to this
  repo — no other SQL lives in-repo for this project) to create
  `time_codes`, `time_card_audit_log`, and alter `time_entries`
  (drop day_start/day_end, add time_code_id, new unique constraint on
  employee_id+work_date+time_code_id). Not yet applied as of this entry.
- `time_card_audit_log` has no RLS/append-only enforcement yet — a direct
  API call could bypass tkLogAudit() or tamper with existing rows in the
  current POC. Must be enforced (INSERT-only policy, no UPDATE/DELETE
  grants) before this satisfies DCAA in any environment with live data.
- Pre-existing `time_entries` test rows (from before this change) have no
  `time_code_id` and will render oddly grouped under one blank row in the
  new matrix — not data-migrated, since this is demo/POC data only
  (flagged to user; recommend truncating test data before trying the new
  screen).
- `pto_accrual_rate` on `profiles` may still represent a biweekly rate;
  the projection math in `tkComputePtoStats()` now assumes hours/week —
  needs confirming with payroll/HR before this number is trusted.
- Old `project_id` column on `time_entries` is no longer written by the
  app but was not dropped, pending the customer/contract data-model
  cleanup noted below.
- BACKLOG (explicitly deferred, not solved this session): unifying
  `projects`/`gov_contracts`/commercial customers into one real
  customer/contract/CLIN-SLIN data model — `time_codes.gov_contract_id`
  is a nullable placeholder link, not a resolved design.

## 2026-07-16 — Travel Estimate print rebuilt to match spreadsheet groupings (no control impact)
Rewrote `buildTePrintHtml()` (screen-travel-estimate.js) — previously a
6-line summary of rolled-up totals only — to mirror the source
spreadsheet's "To Prime" tab layout and labels line-for-line: header/
destination, Leave On/Return On dates, Per Diem Rates (Lodging*/M&IE
columns) with "*includes taxes" footnote, Number of Trainers, an
"ODC (Per Traveler)" section (Airfare, Airport Parking/Transport,
Baggage, Per Diem Travel/Full Days, Hotel, then Per Traveler/Subtotal),
a "Trip Lead Total" section (Rental Cars/Gas/Parking/Tolls, Mileage,
Shipping To/Back, then Trip lead total), the combined "Estimated Total
Travel Cost (ODC)", an EWW section (hours per trainer, hours total,
dollar total), and a final Grand Total. Applies for both Internal and
Customer/Prime views — the fee multiplier is applied per line item
(matching how the spreadsheet itself displays marked-up figures), not
just to the summary totals.
Status: Implemented. Verified the recomputed "Estimated Total Travel
Cost (ODC)" line matches `teCalc()`'s own `odcInternal`/`odcCustomer`
values exactly (both true) for a test scenario, confirming the
per-line-item math is internally consistent with the stored totals.
No access-control implications — display/print layout only.

## 2026-07-21 — Profile photo upload (SC-13 / SC-28, storage)
Added employee profile photo upload on My Profile > Overview
(screen-profile.js: `uploadProfilePhoto`, `removeProfilePhoto`,
`deleteProfilePhotoFile`). Uploads write to a new Supabase Storage
bucket `profile-photos` (public-read, path-scoped by `auth.uid()`),
then PATCH `profiles.photo_url`. Client-side validation: image
MIME type only, 5MB max. Replacing a photo deletes the prior storage
object. Requires a `photo_url` text column on `profiles` and storage
policies (self-scoped insert/delete by path prefix, plus admin
insert/delete) — schema/bucket/policy SQL provided to user to run in
Supabase directly (no DB credentials available to the assistant).
Status: Implemented at UI level (client-side MIME/size checks only,
Supabase POC — no server-side file-type validation yet, matching the
travel-receipts precedent). Gap/follow-up: storage policies must be
applied before this is usable; RLS/policy enforcement still pending
broader Postgres RLS pass called out elsewhere in this log.

## 2026-07-21 — Profile photo shown on Dashboard, Roster, Org Chart (no control impact)
Extended the profile photo (added earlier this session) to render wherever
an employee's avatar circle already appears: My Dashboard header,
Directory > Roster rows, and Directory > Org Chart cards. Added a shared
`avatarHtml()` helper in app-core.js (img when photo_url is set, initials
circle fallback otherwise) instead of duplicating the conditional per
screen. Directory's shared profile fetch (`dirFetchAllProfiles`) now also
selects `photo_url`.
Status: Implemented (display only — reuses the existing public
'profile-photos' bucket and profiles.photo_url column set up earlier;
no new data exposure since profile photos were already public-readable).

## 2026-07-23 — Profile field edit gate fix: removed nonexistent 'department' column (AC-3)
Found while fixing an unrelated Department-display bug: `adminEditableFields`
(app-core.js) listed `department` as an admin-editable profile field, but
`profiles` has no `department` column (only `department_id`, a `departments`
FK, and a deprecated `department_legacy_text`). Since `saveProfile()` bundles
every editable field into a single PATCH, this caused PostgREST to reject
the entire request — meaning **any admin edit of any My Profile > Overview
field was failing**, not just Department. Removed `department` from
`adminEditableFields`; the field is now display-only, rendering the resolved
`departments.name` via `profiles.department_id`. No UI currently exists to
change an employee's `department_id` from this card — deferred, not asked
for in this pass.
Status: Fixed at UI level. Gap/follow-up: same RLS caveat as the 2026-07-16
entry above (admin-only field gating is UI-only, not enforced server-side
in the current Supabase POC).

## 2026-07-23 — Session restore on refresh + 15-minute idle auto-logout (AC-11 / AC-12)
Fixed two gaps found while investigating a user report ("refresh logs me
out", "info can't be shown, try refreshing"): (1) the app never checked for
an existing valid session on page load — sessionStorage held a still-valid
token, but the UI always reset to the login screen on refresh, since
showApp() was only ever called from handleLogin(). (2) There was no session
expiry/idle handling at all, so once the Supabase access token aged out
(no refresh-token flow implemented), API calls started failing with 401s
and users had no clear path back except to re-login manually.
Added to app-core.js: tryRestoreSession() runs on DOMContentLoaded and
restores the signed-in view if a session exists, its token hasn't expired
(computed from a self-recorded `_savedAt` timestamp + `expires_in`, not
trusting the API's `expires_at` format), and the user wasn't idle past 15
minutes when the page was last open. A 15-minute idle timer
(resetIdleLogoutTimer/handleUserActivity, listening on click/keydown/
mousemove/scroll/touchstart) auto-logs-out via handleLogout('idle'), which
now shows "Signed out after 15 minutes of inactivity." on the login screen.
Status: Implemented (demo-scoped). Explicitly does not implement
refresh-token rotation — access tokens still just expire and require
re-login; deferred since this whole flow is Supabase-POC-only and will be
replaced by Entra ID Gov SSO. Idle timeout is currently hardcoded at 15
minutes (IDLE_TIMEOUT_MS in app-core.js), not admin-configurable.

## 2026-07-23 — Staff Recall broadcast (AC-3 / AU-2 / AU-3)
Added Directory > Staff Recall (admin-only): broadcasts an email to every
matching employee's work + home address (optionally filtered by a
free-text substring match against profiles.location), with a per-recipient
unique confirm-receipt link. New tables: `staff_recall_broadcasts` (who
sent it, when, subject/message, location filter used, recipient count) and
`staff_recall_recipients` (one row per person actually emailed, their
ack_token, and acknowledged_at once they click the link). This is the
first feature in the app with a real server-side component — a Supabase
Edge Function (`supabase/functions/staff-recall`) — since browser JS can
never safely hold an email-provider API key or send on behalf of "every
employee" without a trusted authorization check. The function independently
verifies the caller's role against `profiles.role` server-side before
sending anything; this is notable because every other admin-only gate in
the app so far (Admin nav tab, My Team, editable profile fields, etc.) is
UI-only and technically bypassable by a direct API call, since there is no
RLS yet. Email sent via Resend; confirmation clicks require no login (token
in the URL is the only credential, matching common "click to confirm"
patterns — not used for anything sensitive beyond marking receipt).
Status: Implemented (demo-scoped, best-effort — no delivery guarantee, no
SMS/Teams channel yet, deferred per user decision until the Entra ID/Azure
crossover). Gap/follow-up: no RLS on the two new tables (matches every
other table in this Supabase POC); location filtering is free-text
substring match, not a structured field, per user's explicit choice to
defer until office/location data entry conventions are confirmed.

## 2026-07-23 — Staff Recall recipient selection UI (AU-2 / AU-3, before first use)
Reworked Staff Recall's recipient selection before its first real send (no
broadcasts had been sent yet, so this was a clean schema change, not a
migration). Replaced the single free-text location-substring filter with
three explicit modes: Email All, Select Region (a clickable gallery of the
exact distinct location values found on file — exact match, not substring,
since the gallery only ever offers values that actually exist), and
Hand-Pick Staff (a checkbox list of individual employees). Hand-Pick exists
specifically so a deliberate, individually-selected send is distinguishable
in the audit trail from a broader filtered blast — user's own reasoning for
wanting it was "so it's logged that the communication went out" to those
specific people.
Schema: staff_recall_broadcasts.location_filter renamed to filter_summary;
added recipient_mode (check constraint: all/region/handpick). Recipient
matching still happens both client-side (for the live "N employees will be
contacted" preview, shown above the Subject field per user's UI request)
and independently server-side in the Edge Function (re-derives the same set
from recipientMode/locations/employeeIds rather than trusting a recipient
list posted from the browser).
Status: Implemented (demo-scoped, pre-first-use). Gap/follow-up unchanged
from the prior entry — no RLS yet on either table.

## 2026-07-31 — Data model cleanup: onboarding + survey removal (CM-2/CM-3)
User directed removal of two unfinished concepts ahead of vendor decisions:
(1) `check_onboarding_status` table — no code in this repo ever referenced
it (no schema/migration files live in this repo; the table exists only in
the live Postgres/Supabase instance). Drafted `drop-check_onboarding_status.sql`
(FK-dependency check + `DROP TABLE ... CASCADE`) for the user to review and
run themselves — no DB access from this session. Onboarding flow to be
rebuilt once a payroll processor is selected. (2) Survey concept — no
tables or data-layer code existed, only four placeholder UI stubs (a
dashboard warning box and three "Surveys Due" dash-cards marked
Soon/Coming-soon). Removed all four from screen-dashboard.js, screen-admin.js,
and screen-myteam.js; survey functionality is moving to Microsoft tools
instead of this app.
Status: Implemented (UI removal) / Planned (DB drop — SQL drafted, not yet
run). Gap/follow-up: user must execute drop-check_onboarding_status.sql
against the target Postgres/Supabase instance; confirm no other environment
(e.g. a separate prod-tier DB) still references the table before applying
there.

## 2026-08-05 — Light theme + Appearance preference (CM-3 / SC-8 not applicable, config change)
Added a user-selectable Light theme ("Option A — Navy Lead, Red Accent",
built from the CYBER Offset Alliance logo, approved by user this session)
alongside the existing default-dark theme, plus a Dark/Light toggle on
Profile > Overview that persists the choice. New column
`profiles.theme_preference text NOT NULL DEFAULT 'dark' CHECK (IN
('dark','light'))` — self-service editable via the existing PATCH path used
for other profile fields (no new RLS surface; same trust boundary as
preferred_name/phone). Migration drafted in `add-theme-preference.sql`, not
yet run — user applies to the Supabase POC themselves. Theme is applied via
a `data-theme` attribute on `<html>` (styles.css `[data-theme="light"]`
token overrides) and cached in `localStorage` (theme name only, no PII) so
a refresh doesn't flash the wrong theme before the profile loads.
Status: Implemented (app code) / Planned (DB migration — SQL drafted, not
yet run). Gap/follow-up: satisfies the CLAUDE.md accessibility requirement
("Light/dark mode user-selectable... default to dark") which had not been
built until now. No RLS change needed. Light-theme semantic colors (amber,
purple status pills) were manually re-picked for WCAG AA contrast on white
rather than reused as-is from the dark palette — worth a contrast-checker
pass before go-live alongside the rest of the AA audit.

## 2026-08-06 — Burndown estimating data model: schema + RLS (AC-3 / AC-6 / AU-2 / AU-9)
Drafted `burndown-schema.sql`: 15 new tables for the contract/customer/
timekeeping burndown backend (customers, contracts, contract_contacts,
billing_nodes self-referencing tree, slins, slin_funding_history,
slin_employee_authorization, labor_categories, employee_rates,
indirect_pools, indirect_rates, admin_audit_log, qbo_sync_mapping). Unlike
every prior POC table in this repo, RLS is turned ON for all 15 tables now
(explicit user decision this session, not deferred) via a shared
`public.is_admin()` SECURITY DEFINER helper that checks `profiles.role =
'admin'` for `auth.uid()`.
- Admin-only tables (customers, contracts, contract_contacts,
  employee_rates, indirect_pools, indirect_rates, qbo_sync_mapping): full
  CRUD gated on `is_admin()`.
- `billing_nodes`: admin full CRUD; read allowed for any authenticated user
  (navigation structure only, not financial detail) — the actual billing
  gate is on `slins`.
- `slins`: admin full CRUD; employee SELECT scoped to rows where an active
  `slin_employee_authorization` row exists for `auth.uid()` as of the
  current date.
- `slin_funding_history` and `slin_employee_authorization`: admin-only,
  and genuinely append-only at the RLS layer — SELECT + INSERT policies
  only, no UPDATE/DELETE policy exists at all, so both are blocked
  regardless of role (not just a UI convention, unlike the
  `time_card_audit_log` gap noted 2026-07-31). Employees additionally get a
  narrow SELECT on their own `slin_employee_authorization` rows.
- `admin_audit_log`: same append-only pattern (admin SELECT + INSERT only).
- `labor_categories`: admin write, read open to all authenticated users
  (non-sensitive reference data).
- `employee_rates` intentionally has no employee read policy at all —
  `pay_rate` is compensation data; access is admin-only in both directions.
Status: Implemented (SQL run successfully against the Supabase POC by the
user). Gap/follow-up: policies assume `profiles.id`/`profiles.role`
continue to match current app-core.js `isAdmin()` logic; if `profiles`
schema changes, `is_admin()` must be revisited.

## 2026-08-06 — Burndown screen: admin-gated UI (AC-3 / AC-6)
Added `screen-burndown.js` + a new "Burndown" nav item, first UI increment
against the schema above: Customers/Contracts CRUD (create + edit, no
delete) and a Billing Tree view (billing_nodes, expand/collapse,
click-to-select) with SLIN detail (slin fields, funding-mod entry,
employee-authorization grant/revoke). Nav button `nav-btn-burndown` follows
the exact same visibility gate as `nav-btn-admin` in
`checkAdminNavVisibility()` (queries `profiles.role` for the signed-in
user, hidden unless `admin`) — this is a client-side convenience only, not
a trust boundary; the real gate is the `is_admin()` RLS policies from the
2026-08-06 schema entry above, so a non-admin hitting the API directly is
still blocked at the DB layer regardless of what the nav shows. No delete
UI anywhere in this screen (create/edit only, deferred). "Revoke" on an
authorization row inserts a new `status='revoked'` row rather than
mutating the existing one, consistent with the append-only enforcement on
that table. Out of scope this pass: contract_contacts, labor_categories,
employee_rates, indirect_pools, indirect_rates, admin_audit_log,
qbo_sync_mapping — no UI yet, later sessions.
Status: Implemented (app code, static read-through verified — no dangling
onclick references). Not yet browser-tested live (per CLAUDE.md UI rule,
user verifies after deploy). Gap/follow-up: relies on `crypto.randomUUID()`
(client-generated PKs for billing_nodes/slins/funding/authorization rows,
needed so a new node's id is known immediately for a same-submit SLIN
insert) — fine for the evergreen-browser internal admin audience of this
POC, would need a fallback if IE11/very old browser support were ever
required (not expected here).

## 2026-08-06 — Burndown: contract_contacts UI, option_year, bulk SLIN entry (AC-3)
Driven by a real Task Order Mod document the user provided as a test case.
`add-slin-option-year.sql`: adds `slins.option_year` (free text — "Base
Year"/"OY1"/"OY2"/etc. vary by contract, deliberately not a CHECK enum),
plus an index for filtering. Not yet run against the Supabase POC — user
applies it (same as every other standalone migration file in this repo).

`screen-burndown.js` additions:
- Contract Contacts UI (Technical/Contractual/Security/Billing POC —
  name/email/phone) wired into Add Contract, Edit Contract, and the new
  Add Customer combined flow. Upsert-by-role (PATCH existing, POST new);
  no delete UI, consistent with the rest of this file.
- Option Year exposed on both the single Add/Edit SLIN forms and the new
  bulk-entry rows; the Billing Tree gained an Option Year filter (SLIN-
  level match plus its ancestor chain stays visible so the tree doesn't
  show orphaned leaves) and a new "SLIN Table" subtab shows a flat,
  option-year-filterable view of a contract's existing SLINs with each
  one's latest cumulative funding.
- New reusable bulk-entry widget (`bdBulk*`): add N SLIN rows in one
  screen (SLIN code/description/category/contract type/option year/PoP/
  previous-award-cumulative funding), review, then save all in one
  Confirm action. One shared mod_number/mod_date/source_document per
  batch, matching how a real mod document lists many SLINs under one mod.
  Mounted standalone in SLIN Table (own Review/Save flow) and embedded
  inside Add Customer's "also add first contract" toggle (no separate
  save button there — the outer Add Customer submit collects the staged
  rows and commits customer -> contract -> contacts -> SLINs/funding in
  one sequence using client-generated UUIDs throughout).
Status: Implemented (app code; `node -c` syntax-checked; static
onclick/onchange reference check — no dangling calls). Not yet browser-
tested live. Gap/follow-up: no real DB transaction — if a multi-row Add
Customer or bulk-save submit fails partway through, earlier rows in that
sequence are already committed and the error message says so, but nothing
auto-rolls-back; admin needs to check the Customers list / SLIN Table
before retrying. Signature capture and document file upload/Blob Storage
wiring remain explicitly out of scope per this session's direction (doc
stays wherever it's currently kept; storage can go on the backlog later).

## 2026-08-06 — Burndown: atomic multi-step submits (CM-3 / SI-10)
Fixes the transaction-safety gap flagged in the entry directly above.
`add-burndown-atomic-rpcs.sql` adds three Postgres functions —
`bd_add_contract`, `bd_bulk_add_slins`, `bd_add_customer_with_contract`
(the last calls the first two) — each doing its entire multi-row insert
inside a single function call, which Postgres runs as one transaction: if
any insert inside raises (including an is_admin() RLS denial), everything
the function did rolls back automatically. None are SECURITY DEFINER —
they run as the calling user, so the existing is_admin() RLS policies on
customers/contracts/contract_contacts/billing_nodes/slins/
slin_funding_history are still enforced exactly as before on every row; a
non-admin caller now gets the whole transaction aborted rather than one
insert failing partway through.
`screen-burndown.js` updated to call these via `dbRpc()` in place of the
prior sequential `dbWrite()` loops: `bdSubmitAddContract` (Add Contract
under an existing customer), `bdSubmitAddCustomer`'s "also add first
contract" branch, and `bdBulkSaveRows` (standalone SLIN Table bulk save).
Numeric fields (fee_percentage, funding amounts) are now passed as raw
strings and cast server-side via `nullif(...,'')::numeric`, so a blank
field becomes SQL NULL instead of relying on client-side `parseFloat`.
Edit Contract's contacts save (`bdSaveContactsForContract`) intentionally
left as-is — it edits existing rows (per-role upsert), not a chain of new
dependent inserts, so the partial-failure blast radius is much smaller
than the create flows this fixes.
Status: Implemented (app code + SQL; `node -c` syntax-checked, no
dangling onclick/onchange references). Not yet browser-tested live.

## 2026-08-06 — Timekeeping Save Week 400 error + OT redesign (SI-11 / CM-3)
Root cause found via live DevTools Network response: `time_entries.earning_type`
has a NOT NULL constraint, but the prior code (`saveTkWeek`, screen-timekeeping.js)
only classified billable (gov_contract/commercial_customer) rows as
regular/overtime and left indirect codes (B&P, BD, Holiday, Vacation, etc.)
null — every Save Week containing a non-billable row failed with Postgres
error 23502 (not-null violation).
Design discussion with user before fixing: decided OT should be computed off
total weekly hours worked (billable + indirect combined), not billable-only —
matches standard DCAA/FLSA practice where OT is a labor-cost concept, separate
from billability. Implemented by classifying every saved row regular/overtime
based on cumulative hours across the whole week (walking all entries in
date order), which also fixes a second pre-existing bug: OT was previously
computed only from the hours being changed in the current save, not the full
week's total, so a second save later in the week could under/over-count OT
against hours already saved from an earlier save. `earning_type` is now
always non-null on insert/update, so no DB migration is needed (dropped the
`fix-time-entries-earning-type-nullable.sql` migration drafted earlier —
unnecessary once earning_type is always populated).
Status: Implemented (screen-timekeeping.js `saveTkWeek`). Not yet browser-
tested live.

## 2026-08-06 — My Team / Admin dashboard: fix stale pending/PTO queries (AC-3)
Follow-up from the OT redesign above: `loadTeamDashboard`/`loadAdminDashboard`
(screen-myteam.js, screen-admin.js) grouped pending time_entries by
`earning_type` values (`pto`/`training`/`travel`/`admin`/`award`) that never
match this table's actual values (`regular`/`overtime`/null) — leftover from
a pre-Time-Code design where those were apparently separate earning types.
In the current model the only non-`submitted` status a time_entries row ever
gets is `pending` (a Vacation entry awaiting its linked PTO request's
approval, per tkVacationCode) — travel/training/asset requests already live
in their own tables and are already surfaced by the dashboard's other cards
(travelPendingSummaryHtml, asset_requests query). Simplified grouping to just
timecard (`status='submitted'`)/pto (`status='pending'`). Also fixed the "Out
Today (Approved PTO)" query, which filtered `earning_type=eq.pto` (a value
that never occurs) instead of the Vacation time code — now resolves the
Vacation time_code_id via tkVacationCode/tkGetTimeCodes and filters on that
plus `status=eq.approved`.
Status: Implemented (screen-myteam.js, screen-admin.js). Not yet browser-
tested live.

## 2026-08-06 — Pay period certification, Step 1: schema + employee flow (AC-3 / AU-2 / AU-9 / SC-28)
Design discussion with user before building (semi-monthly 1-15/16-end pay
periods, separate from the existing Mon-Sun weekly entry grid): employees
must certify a DCAA-style attestation at the end of each pay period before
it's submitted for admin approval; admin certifies separately before
payroll (Step 2); admin can enter time on an employee's behalf under
special circumstances and can reopen a certified period for correction
(Step 3). Full 3-step build plan agreed; this entry covers Step 1.
New table `pay_period_certifications` (pay-period-certifications-schema.sql)
tracks status (open/employee_certified/admin_certified) per employee per
period. Deliberately given NO insert/update/delete RLS policies at all —
every write goes through one of three SECURITY DEFINER Postgres functions
(certify_period_employee implemented this step; certify_period_admin and
reopen_period created now but not yet called from the UI, landing in
Steps 2-3) that enforce the real business rules (every weekday in the
period must have hours before certifying; admin can't certify before the
employee; reopen requires a reason) — RLS alone can't express those
cleanly. This is a deliberate, documented deviation from
add-burndown-atomic-rpcs.sql's "no SECURITY DEFINER, rely on table RLS"
convention (explained in the SQL file's header comment). Also added
`time_entries.entered_by` (nullable), for the Step 3 admin-entry feature.
Employee flow (screen-timekeeping.js): after every Save on the Current
week, checks whether the pay period containing today is now fully covered
(every weekday has a non-rejected entry with hours > 0) and not yet
certified; if so, auto-shows a popup with the canned certification
statement. Cancel leaves a persistent "Submit Pay Period for Approval"
button next to Save Week so they can keep correcting entries and submit
later without re-triggering the popup. Confirming calls
certify_period_employee via RPC, then logs the event to the existing
time_card_audit_log (action `period_certify_employee`) — no new logging
table needed. Once certified, that period's dates become read-only on the
weekly grid (per-day, not per-week, since a week can straddle a period
boundary).
Added a generic reusable `#dynamic-modal` overlay (index.html + app-core.js
showDynamicModal/closeDynamicModal) so Steps 2-3's popups don't each
reinvent modal markup. Also improved dbRpc() to surface the actual
Postgres exception message instead of a bare status code — needed so the
"every weekday needs hours" validation message reaches the user, but
benefits every RPC caller in the app.
Status: Implemented (schema + employee-side flow). Not yet browser-tested
live. Gap/follow-up: entry locking is enforced client-side (disabled grid
cells) only — time_entries itself has no RLS in this POC environment, so a
direct API call could still write to a certified period's dates until
Azure/RLS migration. Steps 2 (admin certify-for-payroll UI, notes-on-approve,
remove bulk Approve All in favor of per-time-code-line approval) and 3
(admin-entered time, reopen UI) still to come.

## 2026-08-06 — Pay period certification, Step 2: admin certify-for-payroll + notes on approve (AC-3 / AU-2 / AU-9)
Confirmed with user: Approve All stays exactly as it is (one employee, one
week, one card at a time) — there is no cross-card/cross-employee bulk
approval today and none is being built; the earlier "review each
submission" request was about that distinction, not per-line approval.
Weekly Approve All (screen-timekeeping.js teamTkApproveAll, shared by
screen-myteam.js/screen-admin.js) now opens a confirm popup with an
optional notes field before approving — logged into time_card_audit_log
alongside the approval, so there's a DCAA-relevant record if an admin
needs to explain anything unusual (e.g. entering hours on an employee's
behalf).
Added a Pay Period admin/My Team review view — a "Weekly Review / Pay
Period" toggle inside the existing Timekeeping subtab (no new top-level
nav). Shows a read-only rollup of the whole semi-monthly period (reuses
tkRenderGridTable, which turned out to already be day-count agnostic — no
grid changes needed to support >7 columns), the certification status pill,
and a "Certify & Submit for Payroll" action that's only enabled once the
employee has certified (status = employee_certified). Confirming opens a
popup with the second canned statement + an optional notes field, calls
the certify_period_admin RPC (built in Step 1, wired up now), and logs
`period_certify_admin` to time_card_audit_log.
Added tk-status-pill color variants for open/employee_certified/
admin_certified (styles.css) matching the existing amber/teal convention.
Status: Implemented. Not yet browser-tested live.
Gap/follow-up: same as Step 1 — locking/certification gating is
client-side only, no time_entries RLS in this POC. Step 3 (admin-entered
time on an employee's behalf, and the mandatory-reason reopen flow) still
to come.

## 2026-08-06 — Pay period certification, Step 3: admin-entered time + reopen (AC-3 / AU-2 / AU-9)
Completes the 3-step pay period certification build. Two features:

Admin-entered time on an employee's behalf (special circumstances, e.g.
employee unable to enter their own time): the My Team/Admin weekly review
card gets an "Enter Time for Employee" toggle that switches that
employee's grid from read-only to the same editable grid the employee
uses on their own Current week. Saving reuses saveTkWeek() itself (now
generalized with an optional `opts` param: `opts.employeeId` targets the
employee instead of the caller, `opts.onSaved` replaces the employee-
self-service reload with dropping back to the read-only card) rather than
duplicating its validation logic (codeless-row check, missing-PTO
handling, whole-period OT calc). Writes stamp `entered_by` with the
admin's id (schema added in Step 1) so the DCAA trail always shows who
actually entered a row, distinct from `performed_by` on the audit log
entry. The inline "Submit PTO Request" convenience button (for Vacation
hours with no covering PTO request) is not offered in admin-entry mode —
it would submit under the wrong identity — the admin sees guidance to
have the employee request PTO instead.
Generalized `tkg-save-error`/`tkg-missing-pto-panel` from fixed global
ids to containerId-scoped ids (`<containerId>-save-error` etc.) — needed
once a second editable grid (admin-entry) could exist in the DOM
alongside the employee's own; a fixed id would have let one card's error
messages appear in the other's panel.

Reopen (correction path): a Reopen button on the Pay Period admin card,
available once a period is employee_certified or admin_certified. Opens
a popup requiring a reason (enforced client-side and inside
reopen_period's SQL — see Step 1), calls the RPC, and logs
`period_reopen` with the reason to time_card_audit_log. Resets the period
to `open`, clearing both certifications — full before/after state is
preserved via the audit log entry, not attempted to be reconstructed from
table state after the reset.

Status: Implemented. Not yet browser-tested live — all three steps of
this feature are now built and ready for the user to run
pay-period-certifications-schema.sql and verify live.
Gap/follow-up (carried from Steps 1-2): certification/lock enforcement is
client-side only in this POC — no RLS on time_entries yet, so a direct
API call could still bypass the lock or the entered_by stamp. Must be
closed with real RLS once this moves off the Supabase POC.

## 2026-08-06 — Timekeeping Simulation Mode, Stage 1: sandbox + entry/exit (AU-2 / AU-9 / CM-3)
Design discussion with user: admins need a way to demo the full daily-
entry -> employee-certify -> admin-approve -> admin-certify-for-payroll
cycle at will (not tied to the real calendar) without writing anything to
the real database, using Ricky's real account
(954e67be-05cf-4dd9-abaa-ba37790f9032) and the seeded July 16-31 pay
period (seed-ricky-july-pay-period.sql, deliberately left short one day
so the simulation can complete it live).
Built a session-only in-memory sandbox scoped to exactly the 3 tables and
4 RPCs the Timekeeping/My Team/Admin timekeeping screens touch
(time_entries, pay_period_certifications, time_card_audit_log;
certify_period_employee/certify_period_admin/reopen_period/accrue_pto) —
tkReq/tkWrite/tkRpc in screen-timekeeping.js pass straight through to the
real dbRequest/dbWrite/dbRpc when simulation mode is off (zero behavior
change), or read/write an in-memory store seeded once from Ricky's real
data when it's on. The RPC business rules (weekday-completeness check,
certify-order enforcement, mandatory reopen reason) are duplicated in JS
from pay-period-certifications-schema.sql since the real Postgres
functions can't run against in-memory data — documented as a deliberate
duplication to keep in sync if the SQL ever changes.
`tkOffsetForToday()`/`tkCurrentPeriodBounds()` also respect simulation
mode, resolving to a fixed simulated "today" (2026-07-31, the seeded
period's last day) instead of the real clock — this one change makes
every existing week/period-nav, lock, and "Today" button correct for the
simulation for free, no other date logic needed touching.
Explicitly out of scope: the PTO tab and Dashboard widgets are NOT
sandboxed — they still hit the real database even during a simulation.
Only the screens the walkthrough actually uses are covered.
Entry point: an admin-only prompt on the Timekeeping screen ("Start
Simulation"); a persistent amber banner (outside <main>, visible on every
screen) shows while active, with a Guided Walkthrough checkbox (wired,
not yet consumed — Stage 2) and an Exit Simulation button that discards
the sandbox and reloads the real screen.
Status: Implemented (sandbox + entry/exit + banner). Stage 2 (the actual
guided-wizard overlay with the 10 walkthrough steps) not yet built.
Gap/follow-up: My Team/Admin's employee list is entirely replaced by
Ricky while simulation mode is active — an admin can't review a real
employee and run the simulation in the same session; acceptable given
this is a demo aid, not a production workflow.

## 2026-08-06 — Timekeeping Simulation Mode, Stage 2: guided wizard (AU-2 / AU-9)
Completes the simulation mode build. Added a floating wizard panel
(#tk-sim-wizard, fixed bottom-right, styled distinctly from modal popups
so it never blocks them — lower z-index) driven by the Guided Walkthrough
checkbox already wired into the banner in Stage 1. Ten narration-only
steps (TK_SIM_STEPS) walk the admin through the full cycle agreed with
the user: welcome/orientation, enter the last day, watch the auto-popup,
cancel it once to see the persistent submit button, certify for real,
approve each week individually, certify for payroll, try Reopen
(mandatory reason), try Enter Time for Employee, and a closing summary.
Each step pairs a plain instruction with a short "DCAA:" callout
explaining which control this maps to (daily entry, dual attestation,
no-silent-edit locking, audit-attributed exception entry, etc.).
Deliberately narration-only, not action-gated — the wizard doesn't try to
detect that the admin actually clicked Save or opened a popup; it just
shows the next instruction on demand, which is simpler and doesn't break
if they explore out of order.
Guided walkthrough can be toggled off entirely (checkbox in the banner or
"Hide walkthrough" in the panel itself) so a second run can skip the
narration and just use simulation mode freely, per user's explicit ask —
the flag isn't reset on simulation start, so it carries over within the
same session once turned off.
Status: Implemented. Timekeeping Simulation Mode (Stages 1+2) is now
complete. Not yet browser-tested live.

## 2026-08-06 — Two fixes from live demo review (AC-3)
1. Wizard panel (.tk-sim-wizard) was rendering in the same fixed
   bottom-right corner as the existing .demo-feedback-btn, so the
   feedback button visually sat on top of the wizard's Back/Next
   buttons. Moved the wizard's bottom offset from 24px to 100px to clear
   it — no change to the feedback button itself.
2. New rule (explicit user request from testing): once a week has been
   submitted at least once (any saved entries exist for it),
   Saturday/Sunday cells lock for self-service editing — weekend work is
   the exception case, not the norm, so any correction after the fact
   goes through an admin via Enter Time for Employee rather than staying
   open-endedly editable. Implemented in loadTkWeek (screen-timekeeping.js)
   by folding weekend dates into the existing lockedDates mechanism
   tkRenderGridTable already respects — no grid-rendering changes needed.
   Admin-entry mode (teamTkRenderCard) is untouched and still allows
   weekend edits, since that's the intended correction path.
Status: Implemented. Not yet re-verified live.

## 2026-08-06 — Live testing round 2: Return visibility, rejected-day resubmit, Pay Period Overview, admin period edit (AC-3 / AU-2)
Batch of fixes/features from a second live demo pass:

1. Wizard panel moved out of fixed-position entirely — now sits in normal
   document flow directly under the sim banner (pushes content down
   instead of floating over it), fixing the same class of overlap bug as
   the earlier demo-feedback-button fix.
2. New `.btn-danger` class (red fill, same size/font as `.btn-primary`)
   applied to Return and the new Submit Pay Period button — both
   previously used the low-contrast `.btn-logout` style, which read as
   near-invisible next to a bold `.btn-primary` sibling.
3. Fixed a real bug found via Return: a rejected entry's hour cell showed
   no visual indicator in the employee's own editable grid (only in the
   read-only admin view), AND if the employee re-selected the same hours
   value, saveTkWeek's change-detection treated it as "unchanged" and
   never resubmitted it — the entry stayed status='rejected' forever.
   Cells now carry data-entry-status and show a "Returned — re-enter to
   resubmit" pill with the return reason as a tooltip; saveTkWeek always
   writes a rejected cell through as an update regardless of whether the
   value changed.
4. Generalized saveTkWeek to derive its date range from start/end
   (tkPeriodDays) instead of always assuming a 7-day week, AND fixed the
   OT calculation to bucket by each entry's own Monday-Sunday week
   instead of one continuous running total — necessary so a save spanning
   a whole multi-week pay period doesn't miscompute overtime by treating
   the entire period as one long week. Verified this produces identical
   output to the old logic for existing single-week Save Week calls.
5. New Pay Period Overview (tkRenderPayPeriodOverview): once the current
   pay period is complete (or already certified), the Current Week tab
   shows a multi-week grid for the whole period instead of one week, plus
   a category-hours breakdown table and a Save Pay Period/Submit Pay
   Period button pair that toggle based on unsaved-edit state (extended
   tkOnCellChange to detect this) so only one shows at a time. Replaces
   the old auto-popup-on-save + persistent-fallback-button approach
   entirely — the popup now only ever fires from an explicit Submit Pay
   Period click.
6. Admin Pay Period card gets its own "Enter Time for Employee" toggle
   (teamTkPeriodEditMode, separate from the Weekly Review card's own
   toggle), reusing the newly-generalized saveTkWeek to safely save
   across the whole period's date range in one call. Only available while
   the period is status='open' (Reopen first if it's already certified).
7. Certification status now shows who certified and when directly on
   both the employee's Pay Period Overview and the admin's Pay Period
   card (not just buried in the audit log) — who/when was already being
   logged to time_card_audit_log via tkLogAudit; this is a display-only
   addition (teamTkPreloadAdminName resolves the certifying admin's name).
8. New update-ricky-july-weeks-approved.sql: marks 7/16-7/24 as
   status='approved' (the seed script left everything 'submitted') so the
   Pay Period admin view starts from a realistic partially-reviewed state
   — 7/27-7/31 is what actually gets reviewed live in the walkthrough.
9. Explained (not changed) the Flag/Approve-All-greys-out mechanic per
   user's question — it's an intentional but subtle UI: Flag just
   relabels a header link and disables Approve All; the actual action is
   the separate Return button. Flagged as a real usability gap (little
   visible feedback) but not fixed this round — user's focus was
   confirming it works as designed before deciding whether to improve it.
Status: Implemented. Not yet re-verified live.
Gap/follow-up: Reopen button still uses the low-contrast .btn-logout
style (same class as items 2 fixed for Return/Submit) — not reported as
an issue this round, left as-is; worth the same treatment if it comes up.

## 2026-08-06 — Live testing round 3: visibility, locking, cert display (AC-3 / AU-2)
1. Wizard header brightened (stronger background + top/bottom teal
   border) — was too easily missed against the page background.
2. Reopen button given the same .btn-danger treatment as Return/Submit
   Pay Period from the previous round (was still on the low-contrast
   .btn-logout style). Audited every other Timekeeping button for the
   same issue — only one other instance exists (PTO tab's "Cancel
   Request" button), left as-is since the PTO tab is out of scope for
   this simulation work; flagged as a follow-up if it comes up.
3. Fixed a real gap in the Pay Period Overview and the admin Pay Period
   edit-mode: entries from an already admin-approved week were still
   editable there (only the certified-period-wide lock and the weekend
   lock applied). Now any date with an approved entry locks too —
   correcting it means flagging/returning that week in Weekly Review
   first, not quietly editing already-reviewed hours from the period
   view.
4. Certification status pill relabeled to plain "Certified" (was
   "Employee Certified") once the employee has certified, and the
   who/when text now sits directly to the right of the pill instead of
   below the grid — on the admin Pay Period card, the employee's own Pay
   Period Overview, the Weekly Review card, and History (each week's
   containing pay period status now shows next to the Week N label too)
   — this was already being logged to time_card_audit_log; the display
   was the gap.
Status: Implemented. Not yet re-verified live.
Open question sent to user (not built yet): what should happen if an
admin flags/returns an entry from an already-approved week after the
employee has otherwise completed the pay period — does fixing it need to
go through a full re-approval of that week before the period can be
certified, or is completing/resaving the fixed entry (already possible
per the earlier rejected-resubmit fix) sufficient on its own? Multiple
reasonable designs exist here; holding off on building any of them until
that's confirmed.

## 2026-08-06 — Recertification gate: certify_period_admin requires every entry approved (AC-3)
Confirmed with user: if an admin returns an entry from a week that was
already approved, that week must be re-approved (Approve All run again)
before the pay period can be certified for payroll — resaving the fixed
entry on its own isn't enough.
certify_period_admin (both the real RPC in
pay-period-certifications-schema.sql and the simulation sandbox mock in
screen-timekeeping.js) now checks every time_entries row in the period is
status='approved', not just that the employee has certified. Since a
returned-then-resaved entry comes back as 'submitted' (per the earlier
rejected-entry resubmit fix), this naturally blocks period certification
until the admin re-approves that specific week — no new status or table
needed, just a stricter check in the existing gate.
add-certify-admin-approval-gate.sql: standalone patch for anyone who
already ran the original schema file, since certify_period_admin already
exists live. pay-period-certifications-schema.sql itself was also updated
so a fresh install includes the rule from the start.
Status: Implemented. Not yet re-verified live.

## 2026-08-28 — Entra ID auth implementation decisions + inert MSAL scaffold (IA-2 / IA-8 / AC-3)
Decided the three open implementation details for the Aeris migration
track's Entra ID Gov auth (separate/parallel effort from this repo's live
Vercel/Supabase demo — see coa_aeris_migration_track memory):
1. Role claim: Entra **App Roles**, not security-group claims — roles
   (Admin/Employee/Supervisor) defined directly in the "COA - Aeris" app
   registration, token carries a `roles` claim. Chosen so role assignment
   stays fully under COA's control in the app registration, independent
   of Sly Penguin's tenant-wide group structure (Sly Penguin owns the
   shared Azure tenant, not COA).
2. Token storage: `sessionStorage` (MSAL's `cacheLocation` option) —
   consistent with the existing Supabase demo's session pattern; balances
   between forcing re-login on every refresh (in-memory only) and a
   longer-lived exposure window (localStorage).
3. Silent renewal: MSAL's built-in `acquireTokenSilent`, falling back to
   an interactive popup only when the cached token can't be renewed —
   standard library behavior, avoids hand-rolled refresh logic.

Added an inert scaffold to app-core.js (commit 5066db4) encoding these
three decisions: `AERIS_MSAL_CONFIG`, `initMsalClient()`, `aerisLogin()`,
`aerisAcquireTokenSilent()`, `aerisIsAdmin()`. None of it is called from
any event handler and the MSAL.js library itself isn't loaded in
index.html, so this has zero effect on the live demo's Supabase auth
(handleLogin/tryRestoreSession/isAdmin in app-core.js/screen-auth.js are
unmodified).
Status: Planned (decisions locked, scaffold code written; not yet wired
to a login flow or tested). Gap/follow-up: the redirect-URI blocker
cleared 2026-08-28 — Sly Penguin moved the app registration's redirect
URI from "Web" to "SPA" platform, so end-to-end MSAL testing is now
unblocked. Wiring this into the actual login flow (replacing
handleLogin's Supabase call, repointing getSession()/isAdmin() at the
MSAL account object) is still a separate, larger change, planned for once
the Aeris track is ready to go live — not done in this pass, to avoid any
risk to the working demo.

## 2026-08-06 — Scope simulation banner/wizard to Timekeeping pages only (AC-3)
Previously the sim banner and wizard were visible on every screen while
simulation mode was active (rendered outside <main>, only gated on
tkSimMode). Per user request, now only shows on the Timekeeping screen
(any subtab) or My Team/Admin specifically while their Timekeeping
subtab is active — navigating to Dashboard, Profile, Travel, etc. (even
My Team/Admin's own Dashboard subtab) hides both.
tkSimBannerVisibleHere() checks the active .screen and, for My Team/
Admin, whether their Timekeeping subtab specifically is active. Hooked
into switchScreen (app-core.js), switchMyTeamSubtab, switchAdminSubtab,
and switchTkSubtab so visibility re-evaluates on every navigation —
app-core.js calls are typeof-guarded (matches an existing pattern already
in that file) since it loads before screen-timekeeping.js, even though by
call-time (after a user click) the function always exists.
Status: Implemented. Not yet re-verified live.

## 2026-09-08 — Entra ID/MSAL login wired end-to-end for Aeris track (IA-2 / IA-8 / AC-3 / AC-11 / AC-12)
Completes Step 12 (Wire Auth into Frontend) beyond the 2026-08-28 inert
scaffold — login, logout, and session-restore now actually run against
Entra ID on the Aeris deploy, gated by a new `isAerisEnv()` runtime check
(app-core.js) rather than any build-time/deploy-time switch, since the
Vercel demo and the Azure Static Web App both deploy from this repo's same
`main` branch and must pick their auth flow at runtime:
- `handleLogin()` (screen-auth.js) branches to a new `handleAerisLogin()`
  when `isAerisEnv()` is true; the existing Supabase email/password path is
  untouched otherwise.
- `aerisLogin()` (app-core.js): MSAL `loginPopup()`, normalized into the
  same session shape `saveSession()`/`getSession()` already use for
  Supabase, so `showApp()`/`isAdmin()` call sites don't need to branch on
  auth provider.
- `tryRestoreSession()` branches to `aerisTryRestoreSession()`, which
  checks MSAL's own account cache (`getAllAccounts()` +
  `acquireTokenSilent`) instead of the Supabase-shaped expiry check —
  fails quietly to the login screen on any error, matching the existing
  Supabase-expired-session behavior. Silent-only (no popup fallback) on
  this page-load path, since popping a window without a user gesture is
  bad UX and most browsers block it anyway.
- `clearSession()` broadened from removing two named sessionStorage keys
  to `sessionStorage.clear()` — necessary because MSAL's own token cache
  also lives in sessionStorage (the locked token-storage decision), and
  the old narrower clear would have left MSAL's cache intact through
  logout, including the 15-minute idle auto-logout, letting
  `aerisTryRestoreSession()` silently sign the user back in on next load.
  Confirmed via repo-wide grep that no screen file uses sessionStorage for
  anything else, so this is a no-op behavior change for the Supabase demo.
- MSAL.js itself is loaded dynamically (`loadMsalScript()`) only when
  `isAerisEnv()` triggers it, not via a static `<script>` tag in
  index.html — avoids adding an external network request to every page
  load on the Supabase demo for a library it never uses. Sourced from
  jsDelivr (`@azure/msal-browser@5.21.0`, pinned), not Microsoft's own
  CDN — confirmed via web search that Microsoft deprecated CDN hosting for
  msal-browser v3+ entirely (recommends npm/bundler only, which doesn't
  fit this repo's no-build-step architecture).
- MSAL v3+ requires an async `client.initialize()` call before any other
  API use (breaking change from v2) — `getMsalClient()` handles this
  behind a shared promise so a login click racing the page-load
  silent-restore check doesn't create two client instances.

Status: Implemented (Aeris login/logout/session-restore code path).
Gap/follow-up:
- Not yet tested live — I cannot browser-test this myself (no access to
  the Azure SWA deploy or the Entra tenant); needs a live smoke test
  against the real App Registration.
- `dbRequest`/`dbWrite`/`dbRpc`/`dbFunction` still point at Supabase
  regardless of environment — so after a successful Aeris login, every
  data screen (Dashboard, Profile, etc.) will fail to load until the
  Functions/Postgres data layer exists (Step 15+). Expected at this stage
  of the build sequence (auth shell before data screens per CLAUDE.md),
  not a regression.
- `isAdmin()`/`checkAdminNavVisibility()` still read `currentProfile` from
  a Supabase fetch; `aerisIsAdmin()` (reads the `roles` App Role claim) is
  written but not wired into either yet — same Functions/data-layer
  dependency as above.
- Login card still shows email/password fields on the Aeris deploy even
  though `handleAerisLogin()` ignores them (MSAL drives its own popup) —
  known cosmetic gap, not fixed this pass; login still functions via the
  Sign In button regardless of field contents.
- Full Entra IdP session termination (e.g. `logoutPopup()`) was not
  wired — logout clears the local MSAL cache (sessionStorage) but not any
  browser-level Entra SSO cookie, so a signed-out user may get silently
  re-authenticated via SSO on their next login attempt without a password
  prompt. This is normal enterprise SSO behavior, not treated as a gap
  unless COA wants a stricter full-session-termination logout.

## 2026-09-08 — Functions configuration decided; first endpoint scaffolded and validated (CM-6 / IA-2 / IA-8 / AC-3 / SC-8)
Decided the remaining Step 15/16 open fields (checklist "Decide Functions
configuration" and "Set up Functions CI/CD pipeline" cards):
- Hosting tier: Consumption. Matches the current non-VNet Postgres setup
  (no reason to pay Premium's baseline cost for VNet integration not in
  use) and is adequate for a low-traffic internal employee portal.
- CORS: Aeris frontend origins only (Azure SWA default domain +
  aeris.cyberoffset.com once cutover) — the Vercel/Supabase demo never
  calls this API, so it's deliberately excluded. Configured as the
  Function App resource's own CORS setting (standard place for it), not
  in application code.
- CI/CD: GitHub Actions, path-filtered to functions/** so a frontend-only
  commit doesn't redeploy the API — new
  .github/workflows/functions-deploy.yml. No approval gate for now
  (matches the frontend's existing auto-deploy-on-merge); revisit before
  real production go-live. Workflow references
  AZURE_FUNCTIONAPP_NAME/AZURE_FUNCTIONAPP_PUBLISH_PROFILE secrets that
  don't exist yet — won't run successfully until the Function App resource
  is created and those are added.

Scaffolded the Functions project itself (new functions/ folder,
.NET isolated-worker C#, `func init`) and built the first real endpoint
(GetMyProfile) to establish the pattern every later endpoint follows:
- Target framework: .NET 10, not .NET 8 — .NET 8 reaches end-of-life
  2026-11-09 (2 months from this entry), too close to build a new project
  against. Flagging for whoever provisions the Function App resource:
  .NET 10 isolated-worker does NOT run on Linux Consumption plan (only
  Windows Consumption or Flex Consumption support it) — confirmed via web
  search, since this wasn't obvious and would have been a deploy-time
  surprise otherwise.
- EntraAuthMiddleware (functions/Middleware/): hand-rolled JWT validation
  (Azure Functions isolated-worker has no built-in equivalent to App
  Service Easy Auth) — validates issuer/audience/lifetime/signature against
  Entra's own OIDC discovery document, with signing keys cached and
  auto-refreshed by ConfigurationManager so a Microsoft key rotation
  doesn't need a redeploy here. Runs on every HTTP-triggered function via
  builder.UseMiddleware<T>(); rejects with 401 before the request reaches
  any function body. Fails closed if Entra's discovery document can't be
  reached.
- Found and fixed a real gap while building this: the MSAL scope wired in
  the 2026-09-08 auth commit (562df56) requested 'User.Read', which gets a
  token audienced for Microsoft Graph — validating that against our own
  API would always fail (wrong audience). Corrected app-core.js to request
  a scope for the API's own App ID URI instead
  (api://7de6fb71-68ef-410a-84e0-6847fd06cd47/access_as_user). This
  requires the "COA - Aeris" App Registration to have an API exposed with
  an access_as_user scope (Expose an API blade) — Azure-side config not
  yet confirmed done; login will fail until it is.
- AerisRoleMapper (functions/Utils/): maps the validated token's "roles"
  App Role claim to the lowercase role string RLS expects
  (admin/supervisor/employee, most-privileged-wins, defaults to
  'employee' if unassigned). This is the same "roles" claim locked
  2026-08-28 — role is trusted directly from the validated JWT, not
  re-derived from a profiles table lookup, avoiding a chicken-and-egg RLS
  problem.
- AerisDbConnectionFactory (functions/Data/): opens a Postgres connection
  and sets the app.user_id/app.user_role session variables the RLS
  policies key off (set_config, parameterized, is_local=false so it holds
  for the connection's whole session) — using ONLY the validated
  principal's own claims (oid, mapped role), never anything
  client-supplied. This is the one and only place those two session
  variables may be set from in this codebase.
- GetMyProfile (functions/Functions/): the actual first endpoint —
  GET /api/profile/me, queries `profiles` scoped to the caller's own id.
  SELECT list deliberately minimal (id, role only) since the real
  postgres-schema.sql column list for `profiles` isn't available in this
  repo (drafted in a separate session/Claude project — see
  coa_aeris_migration_track memory); extend once that schema is in hand
  rather than guessing column names against a schema this session can't
  see.

Status: Implemented and verified as far as possible without live Azure
access. `dotnet build` succeeds (0 warnings/errors). Ran the host locally
(`func start`) and sent real HTTP requests: a request with no
Authorization header returns 401 "Missing or malformed Authorization
header"; a request with a garbage bearer token returns 401 "Token
validation failed" — confirms EntraAuthMiddleware actually rejects at
runtime, not just compiles.
Gap/follow-up:
- Not tested against a real Entra token or a real Postgres connection —
  needs the App Registration's Expose-an-API scope added, the Function
  App resource created (Consumption tier, correct OS per the .NET 10
  note above), POSTGRES_CONNECTION_STRING wired from Key Vault (still
  "planned, not yet wired" per the checklist), and the two GitHub Actions
  secrets, before any of this can run live.
- Discovered in passing, unrelated to this entry's own work: no GitHub
  Actions workflow exists anywhere in this repo (local, origin, or
  history) for the Static Web App, despite Planner showing "Verify GitHub
  Actions deploy succeeds" as Completed. Flagged to Ricky; not
  investigated further this session — worth reconciling before trusting
  that Planner card.
- isAdmin()/checkAdminNavVisibility() (frontend) and every other screen's
  data calls still aren't wired to this new API — GetMyProfile is a
  pattern-establishing endpoint, not yet consumed by anything.

## 2026-09-08 — Real schema pulled; identity-resolution bootstrap fixed; app_api Postgres role added (IA-2 / IA-8 / AC-3 / AC-6)
Ricky pulled the live database's actual schema, RLS policies, and the
`app` schema's function bodies directly from psql (server-side pg_dump
version was older than the PG18 server, so this used targeted
information_schema/pg_policies/pg_get_functiondef queries instead — see
postgres-schema-live.txt / app-schema-functions.txt). This caught two real
problems in the auth-wiring work above before either reached production:

1. `profiles.id` is NOT the Entra object id — there's a separate
   `entra_object_id` column. GetMyProfile's original query
   (`where id = @id` using the raw Entra oid) would have silently matched
   zero rows for every real user. Worse, `app.current_user_id()` (which
   every RLS policy in the database keys off) is confirmed via
   `pg_get_functiondef` to be a PLAIN read of the `app.user_id` session
   variable — `NULLIF(current_setting('app.user_id', true), '')::uuid`,
   no database lookup of its own — so `app.user_id` has to already BE the
   resolved `profiles.id` before any RLS-gated query can work, and nothing
   in the database did that resolution automatically.
   Fixed with `app.resolve_profile_id(entra_object_id)`
   (add-app-api-role-and-identity-resolution.sql) — SECURITY DEFINER,
   bypasses RLS for this one lookup only, mirroring the existing
   `is_manager_of()` pattern. `AerisDbConnectionFactory.OpenScopedAsync()`
   now calls this first, before setting app.user_id/app.user_role, and
   throws if no profiles row matches (surfaced as a 500 with a clear log
   message rather than a silent empty result).
2. The Functions API's only Postgres credential was `coaadmin` — the
   server admin account. Confirmed this is a real gap, not just
   theoretical: RLS is only an enforced boundary if the connecting role is
   actually subject to it, and an admin-privileged connection used as the
   app's everyday runtime identity means a bug in the API code runs with
   full admin rights instead of being contained by RLS.
   add-app-api-role-and-identity-resolution.sql also creates a dedicated
   `app_api` role — SELECT/INSERT/UPDATE/DELETE on all public tables,
   EXECUTE on all app.* functions, RLS still narrows everything per row
   (including the append-only audit-log tables, which have no
   UPDATE/DELETE policy at all regardless of this role's table-level
   grants) — and the Functions API's connection string should point at
   this role, not coaadmin.

Also confirmed (no code change needed) that the JWT-`roles`-claim role
mapping locked 2026-08-28 is correct as designed: `app.current_user_role()`
is likewise a plain session-variable read, and `app.is_admin()` is just
`app.current_user_role() = 'admin'` — matching what AerisRoleMapper
already produces.

GetMyProfile's SELECT list also extended from the earlier minimal (id,
role) placeholder to the real columns now that the actual `profiles`
schema is known, joined against `departments` for the name — mirrors what
screen-profile.js's Overview tab already reads via Supabase.

Status: Implemented (code) / Planned (SQL — add-app-api-role-and-identity-
resolution.sql drafted, not yet run; same "user runs SQL, not this
session" pattern as every other .sql file in this repo). `dotnet build`
succeeds (0 warnings/errors) after these changes.
Gap/follow-up:
- SQL file has a placeholder password for app_api — must be replaced with
  a real value before running, then stored in Key Vault as a new secret
  and wired into POSTGRES_CONNECTION_STRING as a Key Vault reference
  (closes the "Wire Key Vault references into Functions" Planner card once
  done).
- Still not tested against a live Entra token — the App Registration's
  Expose-an-API scope (2026-09-08 entry above) and this SQL both need to
  be applied before a real end-to-end login-through-to-profile-fetch test
  is possible.
- postgres-schema-live.txt/app-schema-functions.txt added to this repo as
  tracked reference snapshots (same commit) so future sessions don't need
  to re-pull them from the live database. They're point-in-time — reflect
  what existed as of 2026-09-08, not necessarily what's live if the schema
  changes later without a matching re-pull.

## 2026-09-08 — SQL run live; identity chain verified end-to-end against real database (IA-2 / IA-8 / AC-3 / AC-6)
Ricky ran add-app-api-role-and-identity-resolution.sql against the live
psql-coa-prod-eus server (Cloud Shell/psql, coaadmin). Hit and resolved
two real credential-handling issues along the way, both worth noting since
they'll recur if anyone repeats this kind of setup:
- A generated password containing a `$` broke when embedded in a
  double-quoted `psql -c "..."` argument — Bash expanded/stripped part of
  it before psql ever saw it, surfacing as a confusing partial-fragment
  SQL syntax error rather than an obvious password problem. Fixed by
  capturing the password into a shell variable via `read -s` (or
  `$(openssl rand -base64 24)`) and referencing it inside an unquoted
  heredoc instead of a quoted -c argument — avoids Bash re-parsing the
  password's own characters.
- The role creation silently failed on the very first run (no
  ON_ERROR_STOP set, so later grant statements ran — and mostly
  succeeded/no-opped — against a nonexistent role without an obvious
  top-level failure). Re-ran with `psql -v ON_ERROR_STOP=1` so any future
  script run stops immediately and visibly on the first error instead of
  continuing past one silently.

Seeded Ricky's own profiles row (previously empty table — this Postgres
instance has no migrated/seeded data yet, per Step 14's open status) with
his real Entra Object ID, role='admin' (id
29b92693-2c05-4be7-8015-4d84fdc6c380, entra_object_id
5ffa332e-03c6-4dcf-be3c-38cedf8603d2) — needed for real login testing
later regardless, not just today's verification.

Verified live, connected as app_api (not coaadmin):
1. `select count(*) from profiles;` with no session variable set → 0 rows.
   Confirms RLS actually blocks this role by default — the core point of
   moving off coaadmin as the app's runtime identity.
2. With app.user_id manually set to Ricky's profile id via set_config →
   querying that same id returns exactly 1 row (his own). Confirms the
   full chain (role → session variable → RLS policy) works.
3. `select app.resolve_profile_id('5ffa332e-...')` → correctly returns
   29b92693-... (Ricky's profile id). Confirms the actual bootstrap
   function real logins will call works against real data, not just the
   manual session-variable path tested in #2.

Status: Implemented and verified against the live database — this is no
longer just reviewed code, the identity/RLS chain is confirmed working
end to end at the database layer.
Gap/follow-up:
- Confirm Key Vault's psql-coa-prod-eus-app-api-password secret holds the
  password that actually worked (there was back-and-forth during
  troubleshooting above — worth a final check that the value stored there
  matches what's live on the app_api role before trusting it for
  deployment).
- Still not tested through an actual Entra login — everything verified
  today was via direct psql connections as app_api with manually-set
  session variables, not a real MSAL token flowing through
  EntraAuthMiddleware -> GetMyProfile -> AerisDbConnectionFactory. Still
  blocked on the App Registration's Expose-an-API scope and a deployed
  (or locally-run) Function App pointed at app_api via Key Vault.
- Key Vault's psql-coa-prod-eus-app-api-password confirmed by Ricky to
  hold the correct, working password.

## 2026-09-08 — BLOCKED: Ricky lacks edit rights on the App Registration (access control, Sly Penguin-owned tenant)
Attempted the Expose-an-API step needed for the access_as_user scope
(required for the MSAL scope fix logged above to actually work) — Ricky
has no edit rights on the "COA - Aeris" App Registration in Sly Penguin's
shared tenant. The Expose an API blade showed every control disabled with
"Some actions may be disabled due to your permissions."
Status: Blocked. Requested from Sly Penguin: either (a) add Ricky as an
Owner on the App Registration specifically, or (b) Sly Penguin completes
the Expose-an-API step directly (Application ID URI
api://7de6fb71-68ef-410a-84e0-6847fd06cd47, scope access_as_user, Admins
and users, Enabled). (a) is the better ask long-term — this is the second
time in this build that a Sly Penguin tenant permission has stalled
progress (the first was the redirect URI platform fix, 2026-08-28), and
standing Owner access would prevent a third occurrence for whatever App
Registration change comes up next.
Gap/follow-up: blocks any real end-to-end MSAL login test until resolved.

## 2026-09-08 — UpdateMyProfile: second Functions endpoint, establishes the write pattern (AC-3 / SI-10)
Added the write counterpart to GetMyProfile — PATCH /api/profile/me.
Establishes the write pattern every future write endpoint should follow:
an explicit hardcoded allow-list of updatable columns (EditableFields in
ProfileFunctions.cs, matching app-core.js's employeeEditableFields plus
theme_preference), rejecting any request field not on that list rather
than trusting whatever the client sends — the standard defense against a
mass-assignment vulnerability, where a client could otherwise PATCH a
field like `role` or `clearance_level` just by including it in the
request body. Column names are only ever interpolated from that fixed
allow-list (safe — never from request input); values are always
parameterized. Scoped to the caller's own row via the same
identity-resolution chain as GetMyProfile; profiles_update_self's RLS
policy (id = current_user_id() OR is_admin()) double-enforces the
self-only scoping at the database layer even if this code ever had a bug.
Also added a basic value-type check (string or null only, since every
editable field is a text column) and a check-violation-specific catch
(e.g. theme_preference outside its dark/light constraint) returning a
clean 400 instead of falling through to the generic 500.
Status: Implemented. `dotnet build` succeeds (0 warnings/errors). Verified
locally (func start + curl): the route registers correctly and an
unauthenticated PATCH request returns 401, same as GetMyProfile. The
field-validation/allow-list logic itself is NOT yet verified against a
real request, since that requires passing EntraAuthMiddleware first —
still blocked on the same Expose-an-API blocker logged above.
Gap/follow-up: not yet consumed by the frontend — screen-profile.js still
calls Supabase directly for these same fields (theme_preference,
preferred_name, phone, home_email, home_phone, known_traveler_number,
bio) via three separate PATCH calls; wiring the frontend over to this one
consolidated endpoint is a later step, not done here.

## 2026-09-08 — GetMyResume: third Functions endpoint, jsonb handling pattern (AC-3)
GET /api/resume/me — same read/scoping pattern as GetMyProfile, plus one
new wrinkle worth documenting for future endpoints: work_history/
education/certifications/skills are jsonb columns. Npgsql returns jsonb as
a plain string by default; the code parses each one via
JsonDocument.Parse() before embedding it in the response, so
System.Text.Json serializes it as real nested JSON. Skipping that step
(returning the raw string directly) would double-encode it — the client
would receive a JSON string containing escaped JSON text instead of a
usable object. resumes.id is confirmed NOT a separately-generated key —
it's the same uuid as the owning profiles.id (a 1:1 extension table),
matching what resumes_select's RLS policy checks.
Status: Implemented. `dotnet build` succeeds (0 warnings/errors). Verified
locally — route registers, unauthenticated request returns 401. Same live
Entra token limitation as the other two endpoints.
Gap/follow-up: not yet consumed by the frontend. Write side (resume
edits) not built yet — this is read-only for now.

## 2026-09-08 — Travel programs: fourth/fifth endpoints, transaction-wrapped replace-all (AC-3 / SI-10)
GET /api/travel-programs/me (list) and PUT /api/travel-programs/me
(replace-all) for employee_travel_programs (known traveler numbers,
airline/hotel program memberships). Mirrors the frontend's existing
pattern exactly — screen-profile.js already does DELETE-all then
POST-the-new-set rather than per-row upsert — but wraps both statements
in one Npgsql transaction here, since a failure between the DELETE and
the INSERT would otherwise silently wipe an employee's saved travel
programs with nothing to show for it. Same atomicity concern the
burndown-schema atomic RPCs solved for multi-step Postgres-side writes
(ssp-log.md 2026-08-06), just handled at the Functions layer this time
instead of a Postgres function, since this is a straightforward two-step
sequence rather than something RLS-sensitive enough to need a
SECURITY DEFINER wrapper. The session variables set by
AerisDbConnectionFactory persist across the transaction boundary fine
(set_config's is_local=false scopes them to the whole connection, not
just one transaction).
Status: Implemented. `dotnet build` succeeds (0 warnings/errors). Verified
locally — both routes register, unauthenticated requests to each return
401.
Gap/follow-up: not yet consumed by the frontend. Basic required-field
validation only (all three fields non-empty) — no validation against a
fixed set of program_type values, matching the schema (no CHECK
constraint exists on that column either).

## 2026-09-08 — Found and fixed RLS gap: assets/asset_requests had no self-service access (AC-3 / AC-6)
While building Profile's Assets tab endpoints, found that `assets` and
`asset_requests` each have only one RLS policy — assets_admin_all /
asset_requests_admin_all, both app.is_admin()-only. Under the RLS as
deployed, a regular employee querying their own assigned assets or their
own asset requests gets zero rows back, silently — not an error. Every
other employee-facing table in this schema (profiles, resumes,
employee_travel_programs, time_entries, etc.) has a matching self-access
policy alongside its admin one; these two were the only tables missing
it, and it would have made the Profile/My Team Assets tabs (already built
and live in the Supabase demo) silently return nothing once ported to
this backend.
add-asset-self-service-rls.sql (drafted, not yet run) adds:
- assets_select_self_or_manager: SELECT, self OR is_manager_of() OR
  is_admin() — matches this schema's dominant convention for
  self+manager+admin read access (same shape as profiles_select,
  time_entries_select, travel_estimates_select). Read-only — editing an
  asset record stays admin-only, since these are equipment records, not
  something an employee or their supervisor self-attests.
- asset_requests_select_self_or_manager: same shape, for viewing requests.
- asset_requests_insert_self: employees can submit their own requests;
  approving/denying stays admin-only via the existing admin_all policy.
Status: Planned (SQL drafted, given to Ricky to run — same pattern as
every other .sql file in this repo). Gap/follow-up: self-service
assets/asset_requests endpoints will compile and run either way, but
return empty for non-admin callers until this SQL is applied.

## 2026-09-08 — Assets self-service: sixth, seventh, eighth endpoints (AC-3 / SI-10)
GetMyAssets (GET /api/assets/me), GetMyAssetRequests (GET
/api/asset-requests/me), SubmitAssetRequest (POST /api/asset-requests/me)
— completes Profile's Assets tab. Two things worth flagging on the write
side:
- requested_by is always the resolved profile id from the validated
  token, never a client-supplied value — the current frontend actually
  sends session.user.id itself in the request body (screen-profile.js),
  which this endpoint deliberately ignores rather than trusts.
- status is restricted to 'draft'/'pending' only, rejecting anything
  else with a 400. RLS's asset_requests_insert_self policy (added above)
  doesn't restrict the status value at all — an employee could otherwise
  submit a request with status='approved' directly, skipping the
  approval flow entirely. That check has to live here since RLS doesn't
  cover it.
Status: Implemented. `dotnet build` succeeds (0 warnings/errors). Verified
locally — all three routes register, unauthenticated requests to each
return 401. GetMyAssets/GetMyAssetRequests depend on the RLS fix drafted
above — will return empty for non-admin callers until that SQL is run.
Gap/follow-up: admin-side asset management (create/edit assets, review
and approve/deny requests) and the My Team/Admin team-assets views are
not built yet — this pass covers only the employee self-service side.
Not yet consumed by the frontend.

## 2026-09-08 — Expose-an-API blocker cleared; asset RLS SQL run live (IA-2 / IA-8 / AC-3)
Sly Penguin granted Ricky access on the "COA - Aeris" App Registration.
Expose an API completed: Application ID URI
api://7de6fb71-68ef-410a-84e0-6847fd06cd47, scope access_as_user, Admins
and users consent, Enabled — matches exactly what app-core.js's
AERIS_API_SCOPE already expected. This was the last blocker on a real
end-to-end MSAL login test (redirect URI platform and the MSAL wiring
itself were both already done).
Also ran add-asset-self-service-rls.sql (three CREATE POLICY confirmed in
Cloud Shell) — assets/asset_requests self+manager+admin SELECT access and
asset_requests self-INSERT are now live.
Status: Both Implemented and verified against the live tenant/database.
Next: an actual live login test against the Azure SWA deploy — first
real end-to-end test of the whole auth chain built this session.

## 2026-09-08 — Found the actual live-deploy blocker: wrong GitHub repo; merged and fixed a static-file exposure gap before pushing (SC-28 / CM-3)
The login click that "did nothing" traced back to the real root cause:
the Azure Static Web App deploys from a completely different GitHub
repository — Cyber-Offset-Alliance/coa-employee-portal (org-owned,
private), not this repo (rickgreenfield09-afk/COA-pilot-portal). That
repo's `main` held a one-time 25-day-old snapshot import plus the SWA
deploy workflow file, never updated since — so none of this session's
work (or anything from the prior weeks) was ever actually live. This is
the same "GitHub repo URL / owner not recorded" gap flagged as an open
checklist question since the very first version of this doc.
Fixed: Ricky added rickgreenfield09-afk as a collaborator on the org
repo. Merged aeris-origin/main into this repo's history
(--allow-unrelated-histories, -X ours to keep this repo's current content
over the stale import) — picks up only the one thing unique to that
repo, the SWA deploy workflow, with no force-push needed since their main
becomes an ancestor of the merge commit. Going forward both repos need
every commit (Vercel builds from this one, Azure SWA from the other) —
plan is to push to both remotes each time.
Before pushing (would have triggered an immediate deploy): read the
workflow file closely and found `app_location: "/"` uploads the entire
repo root as public static content, no exclusions. That would have made
ssp-log.md, every .sql file — including postgres-schema-live.txt and
app-schema-functions.txt, which contain real RLS policy/function
internals — and the functions/ C# source all publicly fetchable at the
live URL the moment this deployed. Added staticwebapp.config.json (deny
rules for *.sql, *.md, *.txt, /functions/*, /.github/*, /supabase/*,
/.git/*) before the first real push, not after.
Status: Merge and config fix implemented, about to push. Gap/follow-up:
the exclusion list is a deny-list, not a default-deny allow-list — safer
given the small known set of file types today, but needs manual review
if new sensitive file types get added to the repo root later. Worth
reconsidering an allow-list once the live site is stable enough to risk
testing one without breaking the demo.

## 2026-09-08 — First live login attempt: redirect URI mismatch, then popup-vs-app-root race (IA-2 / IA-8)
First real end-to-end MSAL test against the live Azure SWA deploy.
Two real issues found and fixed in sequence:
1. AADSTS50011 redirect URI mismatch — the App Registration's only SPA
   redirect URI was `.../.auth/login/aad/callback` (Azure Static Web
   Apps' own built-in auth callback path, unrelated to our custom
   MSAL.js implementation, evidently a leftover from initial setup).
   Fixed by Ricky adding the bare origin as a second SPA redirect URI.
2. After that fix, the popup completed the Entra redirect (URL showed
   `#code=...`) but never self-closed — instead it rendered this app's
   entire login screen inside the popup itself, and clicking Sign In
   again there produced "Sign-in failed." Root cause: the popup's
   redirect URI was this app's own root, so landing there loaded the
   full app (screen router, login screen, etc.) AND had to dynamically
   fetch MSAL.js from the CDN itself before MSAL's popup-completion
   handshake could run — racing against (and losing to) the opener
   window's own detection logic, since MSAL's popup self-close requires
   the library loaded and a matching client constructed immediately on
   that page. Confirmed via web search this is a known, documented
   MSAL.js pattern — the standard fix is a dedicated minimal redirect
   page, not reusing the main app's URL.
   Added auth-popup.html: loads MSAL, constructs a matching
   PublicClientApplication, does nothing else. AERIS_MSAL_CONFIG's
   redirectUri now points there instead of the app root. This new exact
   URL needs to be added as a third SPA redirect URI in the App
   Registration before this can be retested.
Status: Fix implemented, not yet retested live — needs the new
auth-popup.html redirect URI registered in Entra first.
Gap/follow-up: the original bare-origin redirect URI (added for issue #1
above) is still registered and now unused by login — left in place since
acquireTokenSilent-only flows conventionally reuse it in some setups;
worth pruning later if it's confirmed unnecessary rather than leaving
an unused registered redirect URI around indefinitely.

## 2026-09-08 — Third live-login issue found and fixed: Azure SWA's default COOP header broke window.opener (SC-8)
After auth-popup.html deployed and its redirect URI was registered, the
popup landed correctly (URL showed the auth code) but stayed open,
blank, never self-closing — no errors in either window's console.
Diagnosed directly rather than guessing further: had Ricky run
`window.opener` in the popup's own DevTools console — returned `null`.
Confirmed via web search that Azure Static Web Apps applies a default
Cross-Origin-Opener-Policy header, and MSAL's popup flow depends entirely
on the opener/popup window relationship to hand back the auth result and
self-close — with window.opener severed, the popup has no way to
communicate back, regardless of anything MSAL's own JS does correctly.
Fixed via staticwebapp.config.json globalHeaders:
Cross-Origin-Opener-Policy: same-origin-allow-popups — the specific COOP
value designed for exactly this case: preserves the opener relationship
for popups the page opens itself, while still isolating unrelated
cross-origin popups. Applied globally (not scoped to just
auth-popup.html) since the opener side (index.html, wherever login is
triggered from) also needs a compatible policy for the relationship to
work at all.
Status: Implemented, not yet retested live — needs this deploy to
complete first.
Gap/follow-up: this is the third distinct issue found in three
consecutive live-login attempts (redirect URI mismatch, popup racing to
load the full app, now a platform-default security header) — each was a
real, separate root cause, not the same bug resurfacing. Worth a full
clean end-to-end retest once this deploys, rather than assuming this is
necessarily the last one.

## 2026-09-08 — Fourth issue and actual root cause found: auth-popup.html used the wrong MSAL mechanism entirely (IA-2 / IA-8)
The COOP header fix didn't resolve it — retested and got a concrete
error this time: `BrowserAuthError: timed_out`, thrown in the opener
window after MSAL's internal wait for the popup elapsed. This is the
real, definitive signal (earlier attempts only had silence to go on).
Research (web search + fetching MSAL's own popup-relay bundle) found the
actual root cause: msal-browser v3+ (we're on v5.21.0) replaced the old
window.opener-polling popup mechanism with a BroadcastChannel-based
"popup relay" — specifically because window.opener is exactly what
Microsoft's own strict Cross-Origin-Opener-Policy: same-origin header on
login.microsoftonline.com breaks, so MSAL stopped depending on it years
ago. auth-popup.html was still using the old pattern (constructing a
full PublicClientApplication and doing nothing else), which was simply
never going to complete a popup flow correctly under current MSAL — the
COOP-header fix in the previous entry was solving a real but
no-longer-relevant problem.
Fixed: auth-popup.html now loads
`@azure/msal-browser/lib/popup-relay/msal-popup-relay.min.js` (a small,
dedicated ~3.6KB bundle, not the full library) and calls
`window.msalPopupRelay.runPopupRelay({ allowedAuthorityOrigins:
['https://login.microsoftonline.com'] })` — MSAL's own documented
mechanism for exactly this dedicated-redirect-page use case. No changes
needed on the opener side (aerisLogin()/AERIS_MSAL_CONFIG) — the relay
page is what was wrong.
Status: Implemented, not yet retested live.
Gap/follow-up: the earlier COOP header (same-origin-allow-popups) is
left in place — harmless either way, and may still be relevant for
things unrelated to this specific popup-relay mechanism. Fourth distinct
issue across four consecutive live-login attempts; if this doesn't
resolve it, the next diagnostic step should be checking whether
BroadcastChannel itself is being blocked (e.g. by a browser
privacy/extension setting), not re-litigating the redirect
URI/COOP/window.opener chain already ruled out.

## 2026-09-08 — Fifth issue: popup relay needs its own explicit config option, not just a matching redirectUri (IA-2 / IA-8)
Retested (outside InPrivate mode, to rule that out) — got past account
picker, password, and the stay-signed-in prompt this time, furthest yet,
but the popup relay itself threw a named error:
`BrowserAuthError: popup_relay_unsupported_flow`. Looked up MSAL's own
error docs directly rather than guessing: this top-level error covers 5
sub-causes (cross-origin relay page, missing window.opener, unparseable
relayed request, non-HTTPS target, or untrusted authority origin) — and
critically, the docs reveal `redirectUri` alone isn't enough to enable
the relay flow; msal-browser needs a SEPARATE `auth.popupRelayUri` config
option on the opener's PublicClientApplication telling it which page is
the designated relay target. AERIS_MSAL_CONFIG only ever set
`redirectUri`; `popupRelayUri` was never set at all, likely why MSAL
wasn't engaging the relay flow correctly regardless of what the relay
page itself did.
Fixed: added `popupRelayUri` to AERIS_MSAL_CONFIG.auth, same value as
redirectUri (the one dedicated page we have).
Status: Implemented, not yet retested live.
Gap/follow-up: if `popup_relay_unsupported_flow` recurs after this fix,
the specific sub-cause to check next is missing window.opener (matches
the null result found two entries above) — the COOP header fix may not
have actually restored it end-to-end through Microsoft's own
login.microsoftonline.com hop, which would need a different approach
than a static config addition to resolve.

## 2026-09-08 — Sixth issue, and a decision to stop chasing the popup entirely: switched to loginRedirect (IA-2 / IA-8)
The popupRelayUri fix changed behavior (popup now opens instead of
hanging) but produced a sixth distinct failure:
`BrowserAuthError: popup_window_error`, with an empty subError (no
further detail available from MSAL's own error object even after
expanding it fully in DevTools). Reproduced identically in a second,
non-Edge browser, ruling out an Edge-specific popup-handle quirk that
looked plausible at first (a real, documented Edge issue, but not this
one, since Chrome hit the same error).

After six consecutive live-tested popup failures across two browsers
(redirect URI mismatch; popup racing to load the full app; Azure SWA's
default COOP header; missing popupRelayUri; popup_window_error with no
further diagnostic detail available) — confirmed with Ricky and switched
architecture rather than continuing to debug the popup mechanism:
`loginPopup()`/`loginRedirect()` and MSAL replaced with a full-page
redirect flow, which has none of this surface area (no popup, no
window.opener, no BroadcastChannel relay, no COOP interaction).

Changes (app-core.js, screen-auth.js):
- AERIS_MSAL_CONFIG.auth.redirectUri reverted to this app's own root
  (window.location.origin) — already registered in the App Registration
  from the earlier AADSTS50011 fix, so no further Entra Portal change
  needed this time.
- aerisLogin() replaced with aerisLoginRedirect() — calls
  client.loginRedirect(), which navigates the tab away and never returns
  a usable value.
- aerisTryRestoreSession() now calls client.handleRedirectPromise()
  first on every page load (MSAL's own requirement) to catch the return
  trip from loginRedirect(), before falling back to the existing
  getAllAccounts()/acquireTokenSilent cache check.
- aerisAcquireTokenSilent()'s interactive fallback (currently unused by
  any call site, kept for future use) changed from acquireTokenPopup()
  to acquireTokenRedirect() for consistency — same reasoning, avoid
  resurrecting the popup mechanism in a secondary path.
- auth-popup.html deleted (grepped first to confirm no remaining
  references) — no longer used by anything.
Status: Implemented, not yet retested live. `dotnet build` N/A (frontend
only); node --check passed on both changed files; grepped for dangling
calls to the old aerisLogin() name, none found.
Gap/follow-up: user experience changes from a popup to a full-page
navigation to Microsoft and back — a deliberate, confirmed tradeoff for
reliability, not an oversight. Worth revisiting popup support later only
if there's a specific product reason to want it back; redirect is the
more standard, better-supported pattern for exactly this kind of
reliability problem.

## 2026-09-08 — First successful live login: entire Aeris auth chain confirmed working end to end (IA-2 / IA-8 / AC-3)
Ricky signed in successfully against the live Azure SWA deploy — full
redirect flow completed, silent SSO on subsequent visits already
working (no repeated password prompt), app shell rendered with his email
in the header and Sign Out available. This is the first real
confirmation that the entire chain built and fixed today actually works
together live: MSAL redirect login -> correctly audienced token
(api://.../access_as_user, not Graph) -> session storage -> app shell
render.
Dashboard shows "Couldn't Load Dashboard" — expected, not a bug. No
Functions API is deployed yet (Step 15+ still pending: Function App
resource not created, POSTGRES_CONNECTION_STRING not wired), so every
data-fetching screen has nothing to call. Login/session is now
fully solved; the remaining Aeris work is standing up the Functions
backend so screens have real data to load.
Status: Implemented and verified live. This closes out Step 12
(Wire Auth into Frontend) for real — auth was the highest-risk step in
the whole build per CLAUDE.md, and it's now proven working end to end,
not just written and locally tested.
Gap/follow-up: aerisIsAdmin()/nav-visibility scoping still not wired to
the real profiles.role (needs the Functions data layer, per the
2026-09-08 GetMyProfile entries above) — today's win was authentication,
not yet authorization-driven UI. Next real blocker for a working demo:
create and deploy the Function App resource.

## 2026-09-08 — Function App resource created; switched Functions CI/CD to OIDC (CM-6 / IA-8 / SC-28)
Created func-coa-prod-eus-01 (Flex Consumption, Linux — the supported
combination for .NET 10 isolated worker; Windows Consumption would also
have worked, Linux Consumption specifically would not), stfunccoaprodeus
storage account, Application Insights, in rg-coa-prod-eus / East US 2.
Closes the "Create Function App & runtime storage account" Planner card.

Found Basic Authentication disabled by default on the new resource (a
secure modern default) — our drafted GitHub Actions workflow used a
publish-profile, which depends on Basic Auth and would not have worked.
Decided with Ricky to switch to OIDC/federated-credential-based
deployment instead of re-enabling Basic Auth, since it avoids storing a
long-lived deployment credential in GitHub at all.

Created a dedicated App Registration "COA - Aeris - GitHub Deploy"
(App ID be14e586-079c-42fa-b407-44cfb9b8829f) — separate from the
"COA - Aeris" user-facing login app, keeping the CI/CD deploy identity
and the employee login identity as distinct concerns. Added a federated
credential scoped to this exact repo/branch (GitHub org ID 314421048,
repo ID 1329963513, entity type Branch, main) — Azure's federated
credential setup now validates against GitHub's immutable numeric
org/repo IDs rather than just names, which are mutable/reassignable.

Status: Blocked on the final piece — granting this service principal the
Website Contributor role on func-coa-prod-eus-01 requires Owner/User
Access Administrator, which Ricky doesn't have on this resource group.
Requested from Sly Penguin (second time this session asking for a
specific role assignment rather than standing elevated access — same
recurring pattern as the App Registration Owner request earlier).
Gap/follow-up: once the role assignment lands, still need to (1) update
.github/workflows/functions-deploy.yml to use azure/login (OIDC) instead
of the publish-profile step, (2) add three GitHub secrets
(AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID) to the
Cyber-Offset-Alliance/coa-employee-portal repo, (3) wire
POSTGRES_CONNECTION_STRING/ENTRA_TENANT_ID/ENTRA_API_AUDIENCE app
settings on the Function App itself, (4) configure CORS to the Aeris
frontend origins per the earlier decision.

## 2026-09-08 — App settings wired; second Sly Penguin role-assignment request (SC-28 / CM-6)
GitHub secrets added (AZURE_CLIENT_ID, AZURE_TENANT_ID,
AZURE_SUBSCRIPTION_ID) — workflow is ready to run as soon as the
Website Contributor role assignment lands. ENTRA_TENANT_ID and
ENTRA_API_AUDIENCE app settings added directly on the Function App
(no blocker — plain configuration, not an IAM action).
POSTGRES_CONNECTION_STRING requires a new Key Vault secret
(psql-coa-prod-eus-app-api-connection-string, the full Npgsql connection
string with the app_api password embedded) referenced via
@Microsoft.KeyVault(...) syntax — this in turn requires the Function
App's system-assigned managed identity to have Key Vault Secrets User
on kv-coa-prod-eus, which hit the same Owner/User Access Administrator
wall as the earlier role assignment. Second Sly Penguin request sent for
this specific role assignment.
Status: Two role assignments now pending from Sly Penguin (Website
Contributor on func-coa-prod-eus-01 for the GitHub Deploy service
principal; Key Vault Secrets User on kv-coa-prod-eus for the Function
App's managed identity). Everything else on the Functions deployment
path is ready and waiting on these.
Gap/follow-up: CORS (Aeris frontend origins) still not configured on the
Function App resource — not yet attempted this session, unclear if it
hits the same permission wall or not.

## 2026-09-09 — Both Sly Penguin role assignments granted; first real deploy triggered (CM-6)
Sly Penguin granted: Website Contributor on func-coa-prod-eus-01 for the
GitHub Deploy service principal, and Key Vault Secrets User on
kv-coa-prod-eus for the Function App's managed identity. Both blockers
from 2026-09-08 cleared.
Added workflow_dispatch to functions-deploy.yml for manual re-runs going
forward (didn't exist before — every prior run had to be triggered by an
actual push to functions/**). This commit itself is the first real
trigger of the deploy pipeline end to end.
Status: Deploy triggered, outcome not yet confirmed — this entry
written at trigger time, not after confirming success live.

## 2026-09-09 — Deploy succeeded; live token test found two real Entra config issues (IA-2 / IA-8)
Deploy succeeded — all 8 functions showing Enabled on func-coa-prod-eus-01.
CORS configured (Aeris frontend origins). Ran the first real live test:
a manual fetch from the browser console against the deployed
GetMyProfile, using Ricky's actual signed-in access token. Found two
real issues in sequence, both fixed live rather than guessed at:
1. IDX10205 issuer validation failed — the App Registration's
   requestedAccessTokenVersion (api.requestedAccessTokenVersion in the
   manifest, the modern Graph-schema name for the older
   accessTokenAcceptedVersion field) was null, causing Entra to issue
   v1.0-format access tokens (issuer sts.windows.net) instead of the
   v2.0 format (issuer login.microsoftonline.com/.../v2.0) our
   middleware validates against. Fixed by setting it to 2 directly in
   the App Registration's Manifest editor (Ricky has Owner access now,
   no Sly Penguin needed).
2. That fix then surfaced IDX10214 audience validation failed — v2.0
   tokens for this API use the bare client ID (GUID) as the aud claim,
   not the api://... App ID URI ENTRA_API_AUDIENCE was set to. Fixed in
   code: EntraAuthMiddleware now validates against BOTH forms
   (ValidAudiences, not a single ValidAudience) — derives the bare
   client ID from the same ENTRA_API_AUDIENCE setting rather than
   needing a second app setting, and accepts either going forward
   rather than assuming one is canonical.
Status: Middleware fix implemented and building clean; deploy
triggered by this commit. Not yet confirmed live — next step is
rerunning the same manual fetch test once this redeploys.

## 2026-09-09 — Real root cause of the empty 401 body: middleware can't reliably write the response itself (IA-2 / IA-8 / SI-10)
After that deploy succeeded, the live test still returned a 401 with a
genuinely empty body (Content-Length: 0, confirmed via the Network tab's
raw Response, not a DevTools filtering artifact as first suspected — a
long detour chasing console log-level filters before checking the actual
HTTP response directly). Researched rather than guessed further:
confirmed this is a known, documented limitation — writing directly to
HttpContext.Response from custom middleware in the isolated-worker +
ASP.NET Core integration model is unreliable (Azure/azure-functions-
dotnet-worker#2325 and others). The correct pattern, per a reference
JWT-middleware implementation for this exact scenario: middleware must
never try to short-circuit the pipeline itself — it always calls next(),
and the function's own return value is the only reliably-serialized
response path.

This reframes what EntraAuthMiddleware's Reject() was actually doing:
every endpoint's `if (context.Items["User"] is not ClaimsPrincipal user)
return new UnauthorizedResult();` check was written as a "should be
unreachable, defensive only" fallback — but it was NEVER ACTUALLY
RUNNING, because on failure the old middleware returned without calling
next(), so the function body never executed at all. The empty-body 401
the client received was the middleware's own broken direct-write,
happening beeline before the function — not the function's intended
response.

Fixed: EntraAuthMiddleware no longer touches HttpContext.Response at
all. On failure it stores a reason in context.Items["AuthError"] and
calls next() unconditionally, letting the function run. Every one of
the 8 endpoints' defensive checks — no longer "unreachable", now the
actual auth boundary — updated to read that reason and return
UnauthorizedObjectResult with a real body instead of a bare
UnauthorizedResult.

This surfaced one more bug while testing locally: context.Items is a
plain dictionary whose indexer throws KeyNotFoundException on a missing
key (unlike a normal lookup), and since the key was never set at all on
the failure path before, this had never been hit — now that next() runs
unconditionally, every endpoint's unconditional `context.Items["User"]`
read would throw a 500 unless the key always exists. Fixed by
initializing context.Items["User"] = null at the very top of the
middleware, before any branch.

Status: Implemented and verified locally — dotnet build clean (0
warnings after fixing a nullable-reference warning from the null
assignment), and a real curl test against the local host now returns
`{"error":"Missing or malformed Authorization header."}` with a proper
401, not an empty body. Pushed; live redeploy triggered.
Gap/follow-up: not yet reconfirmed against the live deployed API with a
real Entra token — that's the next step once this redeploys. This is
the sixth distinct issue found and fixed during Functions deployment
testing today alone (issuer version, audience format, then this
middleware architecture bug) — each a real, separate root cause found
by reading actual errors/response bytes rather than guessing.

## 2026-09-09 — Confirmed live via Log stream: auth validation fully works; missed a second empty-body spot; token has no oid claim (IA-2 / IA-8)
Restarting the Function App didn't change anything (ruled out a stale-
instance/caching theory) — the redeploy WAS current. Watched
Log stream directly while re-running the test, which gave a definitive
answer instead of more client-side guessing: `Executing endpoint
'GetMyProfile'` followed by `Validated Entra token had no 'oid' claim.`
— our own LogWarning call. This proves issuer and audience validation
are now BOTH fully working (the token passed EntraAuthMiddleware
entirely) — the empty body was coming from a SECOND, different bare
`return new UnauthorizedResult();` (the missing-oid-claim check) that
the previous fix pass didn't touch, only the
context.Items["User"]-missing check.
Fixed: all 8 endpoints' missing-oid-claim checks now also return
UnauthorizedObjectResult with a real body, matching the earlier fix.
Real remaining cause found via research, not guessed: v2.0 access
tokens are deliberately smaller than v1.0 and omit several claims
(oid included) unless explicitly requested via optionalClaims in the
manifest — another real side effect of the requestedAccessTokenVersion
fix from earlier today, same category as the audience-format change.
Fixed in the manifest: added `oid` under
optionalClaims.accessToken.
Status: Code fix pushed; manifest fix applied directly by Ricky (no
redeploy needed for a manifest-only change, but a fresh sign-in is,
since the currently cached token predates the claim being requested).
Not yet reconfirmed with a fresh token.
Gap/follow-up: seventh distinct issue found and fixed during Functions
deployment testing today. Worth being alert to more of this same
category (v2.0 token minimalism) if other expected claims turn out
missing later — this is a real characteristic of v2.0 tokens, not a
one-off.

## 2026-09-09 — Eighth issue: oid claim present in token but still unreadable server-side — JwtSecurityTokenHandler inbound claim remapping (IA-2 / IA-8)
After the optionalClaims manifest fix and a fresh sign-in, Ricky proved
via jwt.ms AND an inline JS decode (two alert() popups) that the raw
token genuinely contains `oid: 5ffa332e-03c6-4dcf-be3c-38cedf8603d2` —
yet the server still returned "Token has no 'oid' claim." This ruled
out every token-format theory from the prior two fixes; the problem is
purely in how the server reads the token, not what the token contains.
Root cause: `System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler`
has a default inbound claim-type mapping table that silently renames
several short claim names — including "oid" — to long legacy
WS-Federation-style URI claim types when building the ClaimsPrincipal.
The claim value survives the remap; only its Claim.Type string changes,
so every endpoint's `user.FindFirst("oid")` came back null even though
the claim was genuinely on the principal. A documented, long-standing
.NET JWT library behavior, not specific to this app or this token.
Fixed in functions/Middleware/EntraAuthMiddleware.cs: construct the
JwtSecurityTokenHandler with `MapInboundClaims = false` before calling
ValidateToken, so claim types are preserved exactly as issued.
Status: Implemented, dotnet build verified clean (0 warnings/errors)
locally. Not yet redeployed/reconfirmed against the live API.
Gap/follow-up: eighth distinct issue found and fixed during Functions
deployment testing today, hopefully the last before a real end-to-end
authenticated API call succeeds.

## 2026-09-09 — Milestone: first successful end-to-end authenticated Aeris API call (IA-2 / IA-8 / AC-3)
After the MapInboundClaims fix redeployed, GetMyProfile called live
from the browser console (Bearer token from the active Aeris session)
returned Ricky's real profile row — id, full_name, email, role: admin,
etc. — with no error. This confirms the full chain works end to end:
Entra ID login (redirect flow) → MSAL access token → EntraAuthMiddleware
token validation (issuer, audience, signature, oid claim all correctly
read) → AerisDbConnectionFactory resolving the Entra object id to a
profiles.id via app.resolve_profile_id() → Postgres RLS session
variables (app.user_id/app.user_role) scoping the query → real row
returned. This closes out the chain of eight distinct issues found and
fixed today (redirect URI, popup mechanism/COOP, token version/issuer,
audience format, empty-response-body middleware pattern, missing
context.Items init, missing oid claim in v2.0 tokens, and claim-type
remapping).
Status: Implemented and confirmed live.
Gap/follow-up: the frontend (screen-dashboard.js, screen-profile.js,
etc.) still calls Supabase directly, not this new Functions API — that
wiring is the next task, not yet started. Until that's done, the
Aeris demo will keep showing "Couldn't Load Dashboard" from Supabase
401s even though the real backend now works correctly when called
directly.
