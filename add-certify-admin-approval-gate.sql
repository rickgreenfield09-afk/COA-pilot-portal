-- Patch to certify_period_admin (pay-period-certifications-schema.sql):
-- adds a gate requiring every time_entries row in the period to be
-- status='approved' before it can be certified for payroll — not just
-- that the employee has certified.
--
-- Closes a gap: if an admin flags/returns an entry from a week that was
-- already approved (e.g. correcting a mistake after the employee
-- certified the whole period), the employee can fix and resave it (goes
-- back to 'submitted', not 'approved' — see the rejected-entry resubmit
-- fix in screen-timekeeping.js), but that week now needs Approve All run
-- again before the period as a whole can be certified for payroll.
-- Without this gate, certify_period_admin would have let it through with
-- a stale approval on a week that was actually re-reviewed nothing.
--
-- Run once in the Supabase SQL editor, after pay-period-certifications-schema.sql.

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
