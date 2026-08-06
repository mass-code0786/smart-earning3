-- The aligned deployment constructor creates a fresh registration entitlement
-- for genesis. Bridge that deployment-scoped entitlement into the cumulative
-- database projection only when an immutable legacy genesis placement exists.
DO $$
DECLARE
  aligned_contract constant varchar(42) := '0xf2f759f3916f18c12ac5289fe73e79fd68500f8c';
  aligned_genesis constant varchar(42) := '0xfd314f3a6e47a802a73da6d620ab3114f14d042f';
  genesis_user_id uuid;
  eligible numeric(78,0);
  cap_increment numeric(78,0);
  projected_cap numeric(78,0);
  inserted_ledger uuid;
BEGIN
  SELECT u.id,s.registration_value,s.registration_value*5,s.total_earning_cap+s.registration_value*5
  INTO genesis_user_id,eligible,cap_increment,projected_cap
  FROM users u
  JOIN user_package_states s ON s.user_id=u.id
  WHERE u.wallet_address=aligned_genesis
    AND EXISTS(
      SELECT 1 FROM matrix_placements p
      WHERE p.user_id=u.id AND p.parent_user_id IS NULL
        AND p.contract_address IS NULL
    )
  FOR UPDATE OF s;

  IF genesis_user_id IS NULL THEN RETURN; END IF;

  INSERT INTO earning_cap_ledger(
    user_id,source_type,source_reference,eligible_value,cap_increase,total_cap_after
  ) VALUES(
    genesis_user_id,'CONTRACT_GENESIS',aligned_contract,eligible,cap_increment,projected_cap
  )
  ON CONFLICT(source_type,source_reference) DO NOTHING
  RETURNING id INTO inserted_ledger;

  IF inserted_ledger IS NOT NULL THEN
    UPDATE user_package_states
    SET total_eligible_value=total_eligible_value+eligible,
        total_earning_cap=total_earning_cap+cap_increment,
        remaining_cap=GREATEST(total_earning_cap+cap_increment-total_earned,0),
        capping_status=CASE
          WHEN total_earned>=total_earning_cap+cap_increment THEN 'CAPPED'
          WHEN total_earned*100>=(total_earning_cap+cap_increment)*90 THEN 'NEAR_CAP'
          ELSE 'ACTIVE'
        END,
        updated_at=now()
    WHERE user_id=genesis_user_id;
  END IF;
END $$;
