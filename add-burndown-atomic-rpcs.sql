-- Fixes the transaction-safety gap flagged 2026-08-06: the Burndown UI's
-- multi-step submits (Add Customer with a contract+contacts+SLINs, and the
-- bulk multi-row SLIN entry) were each a sequence of separate PostgREST
-- calls from the browser -- if one failed partway through, earlier rows
-- were already committed with no rollback.
--
-- Fix: move each multi-step submit into a single Postgres function. A
-- single RPC call is one transaction -- if any insert inside it raises
-- (including an RLS permission failure), Postgres rolls back everything
-- the function did, automatically, with no client-side coordination
-- needed. No SECURITY DEFINER on any of these -- they run as the calling
-- user (default: SECURITY INVOKER), so the existing is_admin() RLS
-- policies on customers/contracts/contract_contacts/billing_nodes/slins/
-- slin_funding_history are still enforced on every insert exactly as
-- before; a non-admin caller still gets blocked (whole transaction aborts
-- instead of a lone insert failing).
--
-- Run against the Supabase demo/POC instance, verify, then apply to any
-- other environment. Requires burndown-schema.sql and
-- add-slin-option-year.sql to already be applied.

-- ---------------------------------------------------------------------------
-- bd_add_contract: one contract + its POC contacts, atomically.
-- Used by "+ Add Contract" under an existing customer, and reused by
-- bd_add_customer_with_contract below.
-- ---------------------------------------------------------------------------

create or replace function public.bd_add_contract(payload jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_contract_id uuid := gen_random_uuid();
  contact jsonb;
begin
  insert into public.contracts(
    contract_id, customer_id, prime_contract_number, delivery_order_number,
    subcontract_number, contract_type, fee_type, fee_percentage,
    dpas_priority_rating, payment_terms, status, created_by
  ) values (
    new_contract_id,
    (payload->>'customer_id')::uuid,
    nullif(payload->>'prime_contract_number', ''),
    nullif(payload->>'delivery_order_number', ''),
    nullif(payload->>'subcontract_number', ''),
    payload->>'contract_type',
    nullif(payload->>'fee_type', ''),
    nullif(payload->>'fee_percentage', '')::numeric,
    nullif(payload->>'dpas_priority_rating', ''),
    nullif(payload->>'payment_terms', ''),
    'active',
    auth.uid()
  );

  for contact in select * from jsonb_array_elements(coalesce(payload->'contacts', '[]'::jsonb))
  loop
    insert into public.contract_contacts(
      contact_id, contract_id, contact_role, name, email, phone, created_by
    ) values (
      gen_random_uuid(), new_contract_id,
      contact->>'role', contact->>'name',
      nullif(contact->>'email', ''), nullif(contact->>'phone', ''),
      auth.uid()
    );
  end loop;

  return new_contract_id;
end;
$$;

grant execute on function public.bd_add_contract(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- bd_bulk_add_slins: N billing_nodes/slins/(optional) slin_funding_history
-- rows, atomically. Used standalone by the SLIN Table bulk-entry widget,
-- and reused by bd_add_customer_with_contract below.
-- ---------------------------------------------------------------------------

create or replace function public.bd_bulk_add_slins(payload jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  row_data jsonb;
  new_node_id uuid;
  new_slin_id uuid;
  v_contract_id uuid := (payload->>'contract_id')::uuid;
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_parent_node_id uuid := nullif(payload->>'parent_node_id', '')::uuid;
  v_mod_number text := nullif(payload->>'mod_number', '');
  v_mod_date date := coalesce(nullif(payload->>'mod_date', '')::date, current_date);
  v_source_document text := nullif(payload->>'source_document', '');
  v_prev numeric;
  v_award numeric;
  idx int := 0;
begin
  for row_data in select * from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb))
  loop
    if coalesce(row_data->>'slin_code', '') = '' then
      continue;
    end if;

    new_node_id := gen_random_uuid();
    insert into public.billing_nodes(
      node_id, parent_node_id, customer_id, contract_id, node_type, code, label,
      billable, is_leaf, status, sort_order, created_by
    ) values (
      new_node_id, v_parent_node_id, v_customer_id, v_contract_id, 'SLIN',
      row_data->>'slin_code',
      row_data->>'slin_code' || coalesce(' — ' || nullif(row_data->>'slin_desc', ''), ''),
      true, true, 'active', idx, auth.uid()
    );

    new_slin_id := gen_random_uuid();
    insert into public.slins(
      slin_id, billing_node_id, contract_id, slin_code, slin_description,
      slin_category, contract_type, option_year, pop_start, pop_end, status, created_by
    ) values (
      new_slin_id, new_node_id, v_contract_id,
      row_data->>'slin_code',
      nullif(row_data->>'slin_desc', ''),
      row_data->>'category',
      nullif(row_data->>'contract_type', ''),
      nullif(row_data->>'option_year', ''),
      nullif(row_data->>'pop_start', '')::date,
      nullif(row_data->>'pop_end', '')::date,
      'active',
      auth.uid()
    );

    if coalesce(row_data->>'award_total', '') <> '' then
      v_prev := coalesce(nullif(row_data->>'prev_funding', '')::numeric, 0);
      v_award := (row_data->>'award_total')::numeric;
      insert into public.slin_funding_history(
        funding_id, slin_id, mod_number, mod_date, previous_funding,
        award_total, cumulative_total, source_document, entered_by_admin_id
      ) values (
        gen_random_uuid(), new_slin_id, v_mod_number, v_mod_date, v_prev,
        v_award,
        coalesce(nullif(row_data->>'cum_total', '')::numeric, v_prev + v_award),
        v_source_document, auth.uid()
      );
    end if;

    idx := idx + 1;
  end loop;
end;
$$;

grant execute on function public.bd_bulk_add_slins(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- bd_add_customer_with_contract: customer, optionally its first contract +
-- contacts + SLINs, atomically. Used by Add Customer's "also add this
-- customer's first contract now" flow.
-- ---------------------------------------------------------------------------

create or replace function public.bd_add_customer_with_contract(payload jsonb)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_customer_id uuid := gen_random_uuid();
  new_contract_id uuid;
  contract_payload jsonb := payload->'contract';
  bulk_payload jsonb := payload->'bulk';
begin
  insert into public.customers(
    customer_id, name, customer_type, cage_code, uei, address, is_active, created_by
  ) values (
    new_customer_id,
    payload->>'name',
    payload->>'customer_type',
    nullif(payload->>'cage_code', ''),
    nullif(payload->>'uei', ''),
    nullif(payload->>'address', ''),
    true,
    auth.uid()
  );

  if contract_payload is not null then
    new_contract_id := public.bd_add_contract(
      contract_payload || jsonb_build_object('customer_id', new_customer_id)
    );

    if bulk_payload is not null then
      perform public.bd_bulk_add_slins(
        bulk_payload || jsonb_build_object(
          'contract_id', new_contract_id,
          'customer_id', new_customer_id,
          'parent_node_id', null
        )
      );
    end if;
  end if;

  return new_customer_id;
end;
$$;

grant execute on function public.bd_add_customer_with_contract(jsonb) to authenticated;
