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
