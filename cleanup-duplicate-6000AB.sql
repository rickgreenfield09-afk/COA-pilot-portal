-- One-time cleanup: removes the placeholder 6000AB SLIN under Subcontract
-- 3027-0001 that was manually created before the Mod 19 backfill ran
-- (load-mod19-3027-0001-slins.sql), leaving the real one from the mod
-- document in place.
--
-- STEP 1 -- run this SELECT first and eyeball the result. It should return
-- exactly one row: the placeholder, identified as the 6000AB slin with no
-- rows in slin_funding_history (the real one has a funding row from the
-- backfill). If it returns zero rows or more than one, STOP and tell me
-- what you see instead of running the delete below.

select s.slin_id, s.billing_node_id, s.slin_code, s.created_at
from public.slins s
join public.contracts c on c.contract_id = s.contract_id
where c.subcontract_number = '3027-0001'
  and s.slin_code = '6000AB'
  and not exists (
    select 1 from public.slin_funding_history f where f.slin_id = s.slin_id
  );

-- STEP 2 -- once Step 1 confirms exactly the one placeholder row, run this
-- to delete it (slins row first, then its billing_nodes row -- slins.
-- billing_node_id references billing_nodes.node_id).

-- delete from public.slins s
-- using public.contracts c
-- where c.contract_id = s.contract_id
--   and c.subcontract_number = '3027-0001'
--   and s.slin_code = '6000AB'
--   and not exists (
--     select 1 from public.slin_funding_history f where f.slin_id = s.slin_id
--   )
-- returning s.billing_node_id;
-- -- take the billing_node_id returned above and run:
-- -- delete from public.billing_nodes where node_id = '<paste it here>';
