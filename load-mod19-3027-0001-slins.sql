-- One-time backfill: SLINs + funding history for Subcontract 3027-0001
-- (Geodesicx, Inc.), sourced from "Mod 19 COA 3027-0001-001.pdf" (dated
-- 2026-07-02). Contract confirmed to already exist (contract_id
-- b8e29842-c5fe-4c18-b693-4758402353ec); contract_id and customer_id are
-- both looked up by subcontract_number = '3027-0001' below rather than
-- hardcoded, so this still works if the row's UUID ever changes. Run
-- burndown-schema.sql and add-burndown-atomic-rpcs.sql first if not already
-- applied.
--
-- Two calls to bd_bulk_add_slins, each one atomic transaction:
--   1) The 18 Base Year + OY1 SLINs. The document shows these as already
--      cumulatively funded with no new "Award Total" this mod -- there's no
--      record here of their individual prior mod history, so each is seeded
--      with one funding-history row of previous_funding=0, award_total =
--      their full cumulative total. Good enough to make current balances
--      correct; NOT a substitute for the real mod-by-mod history if that's
--      ever needed.
--   2) The 2 new OY2 SLINs this mod actually funds -- logged as a real
--      Mod 19 award (previous_funding=0, since they're brand new lines).
--
-- Caveat: if you run this from the Supabase SQL editor (not through the
-- app), you're likely on the postgres/service_role connection, which
-- bypasses RLS entirely -- auth.uid() will be null, so created_by/
-- entered_by_admin_id on these rows will be null instead of attributing to
-- your admin profile. Fine for a one-time backfill; flagging so it's not a
-- surprise later when the audit trail shows a gap here.

-- ---------------------------------------------------------------------------
-- 1) Base Year + OY1 SLINs (historical, no new money this mod)
-- ---------------------------------------------------------------------------

select public.bd_bulk_add_slins(
  jsonb_build_object(
    'contract_id', (select contract_id from public.contracts where subcontract_number = '3027-0001'),
    'customer_id', (select customer_id from public.contracts where subcontract_number = '3027-0001'),
    'parent_node_id', null,
    'mod_number', 'Pre-Mod 19 (historical, seeded)',
    'mod_date', '2026-07-02',
    'source_document', 'Mod 19 COA 3027-0001-001.pdf',
    'rows', jsonb_build_array(
      jsonb_build_object('slin_code','6000AB','slin_desc','Base Year Labor/Fee PMAAA PMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-06-25','pop_end','2025-06-24','prev_funding',0,'award_total',10135.63,'cum_total',10135.63),
      jsonb_build_object('slin_code','6000AC','slin_desc','Base Year Labor/Fee APNT OMMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-06-25','pop_end','2025-06-24','prev_funding',0,'award_total',195440.16,'cum_total',195440.16),
      jsonb_build_object('slin_code','6000AD','slin_desc','Base Year Labor/Fee APNT RDTE','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-06-25','pop_end','2025-06-24','prev_funding',0,'award_total',12000.00,'cum_total',12000.00),
      jsonb_build_object('slin_code','6000AE','slin_desc','Base Year Labor/Fee NOTM PMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-06-25','pop_end','2025-06-24','prev_funding',0,'award_total',60790.18,'cum_total',60790.18),
      jsonb_build_object('slin_code','6000AF','slin_desc','Base Year Labor/Fee NOTM OMMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-06-25','pop_end','2025-06-24','prev_funding',0,'award_total',37253.12,'cum_total',37253.12),
      jsonb_build_object('slin_code','6000AH','slin_desc','Base Year Labor/Fee PM AAA PMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-07-30','pop_end','2025-06-24','prev_funding',0,'award_total',25690.36,'cum_total',25690.36),
      jsonb_build_object('slin_code','6000AJ','slin_desc','Base Year Labor/Fee PM AAA PMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-07-30','pop_end','2025-06-24','prev_funding',0,'award_total',52000.00,'cum_total',52000.00),
      jsonb_build_object('slin_code','6000AM','slin_desc','Base Year Labor/Fee PMC PM AAA','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-09-20','pop_end','2025-06-24','prev_funding',0,'award_total',16950.82,'cum_total',16950.82),
      jsonb_build_object('slin_code','6000AN','slin_desc','Base Year Labor/Fee PMC APNT MCTSSA','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-09-20','pop_end','2025-06-24','prev_funding',0,'award_total',61206.88,'cum_total',61206.88),
      jsonb_build_object('slin_code','6000AP','slin_desc','Base Year Labor/Fee NOTM PMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-11-27','pop_end','2025-06-24','prev_funding',0,'award_total',49884.65,'cum_total',49884.65),
      jsonb_build_object('slin_code','6000AS','slin_desc','Base Year Labor/Fee APNT OMMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-11-27','pop_end','2025-06-24','prev_funding',0,'award_total',215537.64,'cum_total',215537.64),
      jsonb_build_object('slin_code','6000AT','slin_desc','Base Year Labor/Fee APNT RDTE','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2024-11-27','pop_end','2025-06-24','prev_funding',0,'award_total',42828.37,'cum_total',42828.37),
      jsonb_build_object('slin_code','6000AV','slin_desc','Base Year Labor/Fee PM AAA PMC','category','Labor/Fee','contract_type','CPFF','option_year','Base Year','pop_start','2025-04-01','pop_end','2025-06-24','prev_funding',0,'award_total',44442.04,'cum_total',44442.04),
      jsonb_build_object('slin_code','6100AC','slin_desc','OY1 Labor/Fee APNT RDTE','category','Labor/Fee','contract_type','CPFF','option_year','OY1','pop_start','2025-06-25','pop_end','2026-06-24','prev_funding',0,'award_total',145229.76,'cum_total',145229.76),
      jsonb_build_object('slin_code','6100AE','slin_desc','OY1 Labor/Fee ACV PMC','category','Labor/Fee','contract_type','CPFF','option_year','OY1','pop_start','2025-06-25','pop_end','2026-06-24','prev_funding',0,'award_total',310232.55,'cum_total',310232.55),
      jsonb_build_object('slin_code','6100AH','slin_desc','OY1 Labor/Fee APNT OMMC','category','Labor/Fee','contract_type','CPFF','option_year','OY1','pop_start','2025-09-15','pop_end','2026-06-23','prev_funding',0,'award_total',317438.30,'cum_total',317438.30),
      jsonb_build_object('slin_code','6100AJ','slin_desc','OY1 Labor/Fee APNT RDTE','category','Labor/Fee','contract_type','CPFF','option_year','OY1','pop_start','2025-09-15','pop_end','2026-06-24','prev_funding',0,'award_total',120614.52,'cum_total',120614.52),
      jsonb_build_object('slin_code','7100AM','slin_desc','OY1 ODC/TRAVEL APNT OMMC','category','ODC/Cost','contract_type','COST','option_year','OY1','pop_start','2025-09-15','pop_end','2026-06-23','prev_funding',0,'award_total',6000.00,'cum_total',6000.00)
    )
  )
);

-- ---------------------------------------------------------------------------
-- 2) OY2 SLINs actually funded by Mod 19
-- ---------------------------------------------------------------------------

select public.bd_bulk_add_slins(
  jsonb_build_object(
    'contract_id', (select contract_id from public.contracts where subcontract_number = '3027-0001'),
    'customer_id', (select customer_id from public.contracts where subcontract_number = '3027-0001'),
    'parent_node_id', null,
    'mod_number', '19',
    'mod_date', '2026-07-02',
    'source_document', 'Mod 19 COA 3027-0001-001.pdf',
    'rows', jsonb_build_array(
      jsonb_build_object('slin_code','6200AE','slin_desc','OY2 Labor/Fee ACV','category','Labor/Fee','contract_type','CPFF','option_year','OY2','pop_start','2026-06-25','pop_end','2027-06-24','prev_funding',0,'award_total',55828.51,'cum_total',55828.51),
      jsonb_build_object('slin_code','6200AH','slin_desc','OY2 Labor/Fee APNT','category','Labor/Fee','contract_type','CPFF','option_year','OY2','pop_start','2026-06-25','pop_end','2027-06-24','prev_funding',0,'award_total',69023.84,'cum_total',69023.84)
    )
  )
);
