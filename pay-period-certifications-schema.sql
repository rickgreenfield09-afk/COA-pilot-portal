-- Semi-monthly pay period certification workflow (1st-15th, 16th-end of
-- month). Two DCAA-style attestations per period: the employee certifies
-- their own timesheet is accurate before it's submitted for approval, then
-- an admin certifies they reviewed it before it's submitted for payroll.
-- Also adds time_entries.entered_by, used by a later patch that lets an
-- admin enter time on an employee's behalf for special circumstances.
--
-- Run against the Supabase demo/POC instance, verify, then apply to other
-- environments. Requires burndown-schema.sql to already be applied (reuses
-- its public.is_admin() helper).
--
-- Deliberate deviation from add-burndown-atomic-rpcs.sql's "no SECURITY
-- DEFINER, rely on table RLS" convention: these three functions enforce
-- real business rules (every weekday in the period must have hours before
-- certifying; admin can't certify before the employee has; a reopen
-- requires a reason) that don't reduce to a simple role check RLS can
-- express in a WITH CHECK clause. So pay_period_certifications gets NO
-- insert/update/delete policies for `authenticated` at all -- the only way
-- to mutate a row is through one of these three SECURITY DEFINER
-- functions, each of which does its own auth.uid()/is_admin() check
-- internally before writing.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Mirrors the manager_id-chain walk getRecursiveReportIds() does in
-- app-core.js, so My Team supervisors can see (not certify) their reports'
-- pay period status.
create or replace function public.is_manager_of(p_employee_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  with recursive reports as (
    select id, manager_id from public.profiles where manager_id = auth.uid()
    union all
    select p.id, p.manager_id from public.profiles p
    join reports r on p.manager_id = r.id
  )
  select exists (select 1 from reports where id = p_employee_id);
$$;

-- ---------------------------------------------------------------------------
-- time_entries: entered_by (used starting with the admin-entry patch)
-- ---------------------------------------------------------------------------

alter table public.time_entries
  add column if not exists entered_by uuid references public.profiles(id);

comment on column public.time_entries.entered_by is
  'Who actually entered this row: null/self for normal employee entry, the admin''s profile id when entered on the employee''s behalf under special circumstances.';

-- ---------------------------------------------------------------------------
-- pay_period_certifications
-- ---------------------------------------------------------------------------

create table if not exists public.pay_period_certifications (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.profiles(id),
  period_start      date not null,
  period_end        date not null,
  status            text not null default 'open'
                      check (status in ('open', 'employee_certified', 'admin_certified')),
  employee_cert_at  timestamptz,
  admin_cert_at     timestamptz,
  admin_cert_by     uuid references public.profiles(id),
  admin_notes       text,
  reopened_at       timestamptz,
  reopened_by       uuid references public.profiles(id),
  reopen_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, period_start, period_end)
);

create trigger pay_period_certifications_set_updated_at
  before update on public.pay_period_certifications
  for each row execute function public.set_updated_at();

alter table public.pay_period_certifications enable row level security;

create policy "ppc_select" on public.pay_period_certifications
  for select to authenticated
  using (employee_id = auth.uid() or is_manager_of(employee_id) or is_admin());

-- No insert/update/delete policies -- see header comment. All writes go
-- through certify_period_employee / certify_period_admin / reopen_period.

-- ---------------------------------------------------------------------------
-- certify_period_employee: employee's own end-of-period certification.
-- Blocks unless every weekday in the period has a non-rejected entry with
-- hours > 0. Upserts the row to employee_certified.
-- ---------------------------------------------------------------------------

create or replace function public.certify_period_employee(p_period_start date, p_period_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing int;
  v_status text;
begin
  select count(*) into v_missing
  from generate_series(p_period_start, p_period_end, interval '1 day') d
  where extract(dow from d) not in (0, 6) -- Sun/Sat
    and not exists (
      select 1 from public.time_entries te
      where te.employee_id = auth.uid()
        and te.work_date = d::date
        and te.hours > 0
        and te.status is distinct from 'rejected'
    );

  if v_missing > 0 then
    raise exception 'Every weekday in the pay period needs hours entered before you can certify (% day(s) still missing)', v_missing;
  end if;

  select status into v_status
  from public.pay_period_certifications
  where employee_id = auth.uid() and period_start = p_period_start and period_end = p_period_end;

  if v_status is not null and v_status <> 'open' then
    raise exception 'This pay period has already been certified';
  end if;

  insert into public.pay_period_certifications (employee_id, period_start, period_end, status, employee_cert_at)
  values (auth.uid(), p_period_start, p_period_end, 'employee_certified', now())
  on conflict (employee_id, period_start, period_end)
  do update set status = 'employee_certified', employee_cert_at = now();
end;
$$;

grant execute on function public.certify_period_employee(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- certify_period_admin: admin's review certification, submits for payroll.
-- Admin-only; requires the employee to have already certified.
-- ---------------------------------------------------------------------------

create or replace function public.certify_period_admin(
  p_employee_id uuid, p_period_start date, p_period_end date, p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_unapproved int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can certify a pay period for payroll';
  end if;

  select status into v_status
  from public.pay_period_certifications
  where employee_id = p_employee_id and period_start = p_period_start and period_end = p_period_end;

  if v_status is distinct from 'employee_certified' then
    raise exception 'The employee must certify this pay period before it can be submitted for payroll';
  end if;

  -- Every entry must be individually approved, not just "the employee
  -- certified" — if an admin returns an entry from a previously-approved
  -- week after certification (e.g. correcting a mistake), fixing and
  -- resaving it (see saveTkWeek's rejected-entry resubmit) puts it back
  -- to 'submitted', not 'approved' — that week needs Approve All run
  -- again before the period can be certified for payroll.
  select count(*) into v_unapproved
  from public.time_entries
  where employee_id = p_employee_id
    and work_date between p_period_start and p_period_end
    and status is distinct from 'approved';

  if v_unapproved > 0 then
    raise exception 'Every entry in this pay period must be approved before it can be certified for payroll (% not yet approved)', v_unapproved;
  end if;

  update public.pay_period_certifications
  set status = 'admin_certified', admin_cert_at = now(), admin_cert_by = auth.uid(), admin_notes = p_notes
  where employee_id = p_employee_id and period_start = p_period_start and period_end = p_period_end;
end;
$$;

grant execute on function public.certify_period_admin(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- reopen_period: admin-only correction path. Requires a reason (goes into
-- the DCAA audit trail from the client side via tkLogAudit). Resets both
-- certifications so the employee/admin must go through the flow again.
-- ---------------------------------------------------------------------------

create or replace function public.reopen_period(
  p_employee_id uuid, p_period_start date, p_period_end date, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reopen a pay period';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to reopen a pay period';
  end if;

  select status into v_status
  from public.pay_period_certifications
  where employee_id = p_employee_id and period_start = p_period_start and period_end = p_period_end;

  if v_status is null or v_status = 'open' then
    raise exception 'This pay period is not currently certified';
  end if;

  update public.pay_period_certifications
  set status = 'open',
      employee_cert_at = null,
      admin_cert_at = null,
      admin_cert_by = null,
      admin_notes = null,
      reopened_at = now(),
      reopened_by = auth.uid(),
      reopen_reason = p_reason
  where employee_id = p_employee_id and period_start = p_period_start and period_end = p_period_end;
end;
$$;

grant execute on function public.reopen_period(uuid, date, date, text) to authenticated;
