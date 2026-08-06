-- Burndown estimating tool data model (contract/customer/timekeeping backend).
-- Run against the Supabase demo/POC Postgres instance, verify, then apply to
-- other environments. RLS is enabled and enforced on every table below (per
-- explicit build decision 2026-08-06) -- this is NOT deferred like earlier
-- POC tables. See ssp-log.md for the corresponding SSP entries.
--
-- Assumes an existing `profiles` table with columns (id uuid references
-- auth.users(id), role text) -- matches current app-core.js isAdmin() logic
-- (currentProfile.role === 'admin'). employee_id / *_admin_id / created_by /
-- updated_by columns below all reference profiles(id).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the policy check can read profiles.role regardless of
-- the calling user's own RLS visibility into profiles; STABLE so Postgres
-- can cache the result within a single statement.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

create table if not exists public.customers (
  customer_id   uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text,
  customer_type text not null check (customer_type in ('Prime', 'Sub-to', 'Gov direct', 'Internal')),
  cage_code     text,
  uei           text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id)
);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

create policy "customers_admin_all" on public.customers
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------

create table if not exists public.contracts (
  contract_id            uuid primary key default gen_random_uuid(),
  customer_id            uuid not null references public.customers(customer_id),
  prime_contract_number  text,
  delivery_order_number  text,
  subcontract_number     text,
  contract_type          text not null check (contract_type in ('CPFF', 'COST', 'FFP', 'T&M')),
  fee_type               text,
  fee_percentage         numeric(6,4),
  dpas_priority_rating   text,
  payment_terms          text,
  status                 text not null default 'active',
  created_at             timestamptz not null default now(),
  created_by             uuid references public.profiles(id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles(id)
);

create index if not exists contracts_customer_id_idx on public.contracts(customer_id);

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

alter table public.contracts enable row level security;

create policy "contracts_admin_all" on public.contracts
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- contract_contacts
-- ---------------------------------------------------------------------------

create table if not exists public.contract_contacts (
  contact_id    uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts(contract_id),
  contact_role  text not null check (contact_role in ('Technical POC', 'Contractual POC', 'Security POC', 'Billing POC')),
  name          text not null,
  email         text,
  phone         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id)
);

create index if not exists contract_contacts_contract_id_idx on public.contract_contacts(contract_id);

create trigger contract_contacts_set_updated_at
  before update on public.contract_contacts
  for each row execute function public.set_updated_at();

alter table public.contract_contacts enable row level security;

create policy "contract_contacts_admin_all" on public.contract_contacts
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- billing_nodes (self-referencing tree; depth varies by customer)
-- ---------------------------------------------------------------------------

create table if not exists public.billing_nodes (
  node_id          uuid primary key default gen_random_uuid(),
  parent_node_id   uuid references public.billing_nodes(node_id),
  customer_id      uuid references public.customers(customer_id),
  contract_id      uuid references public.contracts(contract_id),
  node_type        text not null check (node_type in ('Customer', 'Contract', 'Task Order', 'SLIN', 'Indirect Pool')),
  code             text,
  label            text not null,
  billable         boolean not null default false,
  is_leaf          boolean not null default false,
  status           text not null default 'active',
  sort_order       integer not null default 0,
  effective_start  date,
  effective_end    date,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id)
);

create index if not exists billing_nodes_parent_node_id_idx on public.billing_nodes(parent_node_id);
create index if not exists billing_nodes_customer_id_idx on public.billing_nodes(customer_id);
create index if not exists billing_nodes_contract_id_idx on public.billing_nodes(contract_id);

create trigger billing_nodes_set_updated_at
  before update on public.billing_nodes
  for each row execute function public.set_updated_at();

alter table public.billing_nodes enable row level security;

create policy "billing_nodes_admin_all" on public.billing_nodes
  for all to authenticated using (is_admin()) with check (is_admin());

-- Node labels/codes are navigation structure, not financial detail -- every
-- authenticated employee can read the tree so they can browse it; the actual
-- billing gate lives on `slins` below (authorization-scoped).
create policy "billing_nodes_read_all" on public.billing_nodes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- slins
-- ---------------------------------------------------------------------------

create table if not exists public.slins (
  slin_id           uuid primary key default gen_random_uuid(),
  billing_node_id   uuid not null unique references public.billing_nodes(node_id),
  contract_id       uuid not null references public.contracts(contract_id),
  slin_code         text not null,
  slin_description  text,
  slin_category     text not null check (slin_category in ('Labor/Fee', 'ODC/Cost', 'Materials')),
  contract_type     text,
  pop_start         date,
  pop_end           date,
  fee_percentage    numeric(6,4),
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id)
);

create index if not exists slins_contract_id_idx on public.slins(contract_id);

create trigger slins_set_updated_at
  before update on public.slins
  for each row execute function public.set_updated_at();

alter table public.slins enable row level security;

create policy "slins_admin_all" on public.slins
  for all to authenticated using (is_admin()) with check (is_admin());

-- Employee read policy ("slins_employee_read_authorized") is created further
-- down, after slin_employee_authorization exists -- it references that table
-- and CREATE POLICY requires the referenced table to already exist.

-- ---------------------------------------------------------------------------
-- slin_funding_history (append-only ledger)
-- ---------------------------------------------------------------------------

create table if not exists public.slin_funding_history (
  funding_id        uuid primary key default gen_random_uuid(),
  slin_id           uuid not null references public.slins(slin_id),
  mod_number        text,
  mod_date          date not null,
  previous_funding  numeric(14,2) not null,
  award_total       numeric(14,2) not null,
  cumulative_total  numeric(14,2) not null,
  source_document   text,
  entered_by_admin_id uuid references public.profiles(id),
  entered_at        timestamptz not null default now()
);

create index if not exists slin_funding_history_slin_id_idx on public.slin_funding_history(slin_id);

alter table public.slin_funding_history enable row level security;

-- Admin-only, and append-only: select + insert policies only, no update or
-- delete policy at all, so RLS blocks those outright regardless of role.
create policy "slin_funding_admin_select" on public.slin_funding_history
  for select to authenticated using (is_admin());

create policy "slin_funding_admin_insert" on public.slin_funding_history
  for insert to authenticated with check (is_admin());

-- ---------------------------------------------------------------------------
-- slin_employee_authorization (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.slin_employee_authorization (
  authorization_id  uuid primary key default gen_random_uuid(),
  slin_id           uuid not null references public.slins(slin_id),
  employee_id       uuid not null references public.profiles(id),
  status            text not null check (status in ('active', 'revoked')),
  effective_date    date not null,
  changed_by_admin_id uuid references public.profiles(id),
  changed_at        timestamptz not null default now(),
  reason            text
);

create index if not exists slin_employee_authorization_slin_id_idx on public.slin_employee_authorization(slin_id);
create index if not exists slin_employee_authorization_employee_id_idx on public.slin_employee_authorization(employee_id);

alter table public.slin_employee_authorization enable row level security;

-- Admin-only, and append-only: select + insert only, no update/delete policy.
create policy "slin_auth_admin_select" on public.slin_employee_authorization
  for select to authenticated using (is_admin());

create policy "slin_auth_admin_insert" on public.slin_employee_authorization
  for insert to authenticated with check (is_admin());

-- Employees can see their own authorization history (read-only).
create policy "slin_auth_employee_read_own" on public.slin_employee_authorization
  for select to authenticated using (employee_id = auth.uid());

-- Now that slin_employee_authorization exists, add the slins read policy
-- that depends on it: employees only see SLINs they currently hold an
-- active authorization for.
create policy "slins_employee_read_authorized" on public.slins
  for select to authenticated using (
    exists (
      select 1 from public.slin_employee_authorization sea
      where sea.slin_id = slins.slin_id
        and sea.employee_id = auth.uid()
        and sea.status = 'active'
        and sea.effective_date <= current_date
    )
  );

-- ---------------------------------------------------------------------------
-- labor_categories
-- ---------------------------------------------------------------------------

create table if not exists public.labor_categories (
  labor_category_id  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  status               text not null default 'active'
);

alter table public.labor_categories enable row level security;

create policy "labor_categories_admin_all" on public.labor_categories
  for all to authenticated using (is_admin()) with check (is_admin());

-- Reference data (job titles) -- fine for every authenticated employee to read.
create policy "labor_categories_read_all" on public.labor_categories
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- employee_rates
-- ---------------------------------------------------------------------------

create table if not exists public.employee_rates (
  rate_id             uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.profiles(id),
  labor_category_id   uuid not null references public.labor_categories(labor_category_id),
  slin_id             uuid references public.slins(slin_id),
  pay_rate            numeric(10,2),
  bill_rate           numeric(10,2),
  bill_rate_with_fee  numeric(10,2),
  effective_start     date not null,
  effective_end       date,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id)
);

create index if not exists employee_rates_employee_id_idx on public.employee_rates(employee_id);
create index if not exists employee_rates_slin_id_idx on public.employee_rates(slin_id);

alter table public.employee_rates enable row level security;

-- Admin-only in both directions -- pay_rate is compensation data; employees
-- are not given read access to their own or others' rows here.
create policy "employee_rates_admin_all" on public.employee_rates
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- indirect_pools
-- ---------------------------------------------------------------------------

create table if not exists public.indirect_pools (
  pool_id                  uuid primary key default gen_random_uuid(),
  pool_name                text not null check (pool_name in ('Fringe', 'Overhead', 'G&A', 'Occupancy', 'Unallowable', 'B&P', 'IR&D')),
  gl_account_number        text,
  gl_account_description   text,
  fiscal_year              integer not null,
  status                   text not null default 'active'
);

alter table public.indirect_pools enable row level security;

create policy "indirect_pools_admin_all" on public.indirect_pools
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- indirect_rates
-- ---------------------------------------------------------------------------

create table if not exists public.indirect_rates (
  rate_id          uuid primary key default gen_random_uuid(),
  pool_id          uuid not null references public.indirect_pools(pool_id),
  fiscal_year      integer not null,
  standard_rate    numeric(8,5),
  actual_rate      numeric(8,5),
  effective_start  date not null,
  effective_end    date,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id)
);

create index if not exists indirect_rates_pool_id_idx on public.indirect_rates(pool_id);

alter table public.indirect_rates enable row level security;

create policy "indirect_rates_admin_all" on public.indirect_rates
  for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- admin_audit_log (append-only, general-purpose)
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_log (
  audit_id        uuid primary key default gen_random_uuid(),
  entity_type     text not null,
  entity_id       uuid not null,
  field_changed   text,
  old_value       text,
  new_value       text,
  changed_by_admin_id uuid references public.profiles(id),
  changed_at      timestamptz not null default now()
);

create index if not exists admin_audit_log_entity_idx on public.admin_audit_log(entity_type, entity_id);

alter table public.admin_audit_log enable row level security;

-- Admin-only, and append-only: select + insert only, no update/delete policy
-- -- an audit trail that could be edited after the fact is not a trail.
create policy "admin_audit_log_admin_select" on public.admin_audit_log
  for select to authenticated using (is_admin());

create policy "admin_audit_log_admin_insert" on public.admin_audit_log
  for insert to authenticated with check (is_admin());

-- ---------------------------------------------------------------------------
-- qbo_sync_mapping
-- ---------------------------------------------------------------------------

create table if not exists public.qbo_sync_mapping (
  mapping_id       uuid primary key default gen_random_uuid(),
  billing_node_id  uuid not null references public.billing_nodes(node_id),
  qbo_entity_id    text not null,
  qbo_entity_type  text not null,
  last_synced_at   timestamptz
);

create index if not exists qbo_sync_mapping_billing_node_id_idx on public.qbo_sync_mapping(billing_node_id);

alter table public.qbo_sync_mapping enable row level security;

create policy "qbo_sync_mapping_admin_all" on public.qbo_sync_mapping
  for all to authenticated using (is_admin()) with check (is_admin());
