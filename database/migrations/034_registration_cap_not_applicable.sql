-- Registration alone creates no earning principal and is not a capped state.
ALTER TABLE user_package_states
  DROP CONSTRAINT IF EXISTS user_package_states_capping_status_check;

ALTER TABLE user_package_states
  ADD CONSTRAINT user_package_states_capping_status_check
  CHECK (capping_status IN ('NOT_APPLICABLE','ACTIVE','NEAR_CAP','CAPPED'));

UPDATE user_package_states
SET capping_status='NOT_APPLICABLE',updated_at=now()
WHERE total_package_value=0
  AND total_eligible_value=0
  AND total_earning_cap=0
  AND remaining_cap=0;

ALTER TABLE user_package_states
  ADD CONSTRAINT package_state_not_applicable_policy
  CHECK (
    (total_package_value=0 AND total_eligible_value=0 AND total_earning_cap=0
      AND remaining_cap=0 AND capping_status='NOT_APPLICABLE')
    OR
    (total_package_value>0 AND total_eligible_value=total_package_value
      AND total_earning_cap=total_package_value*5 AND capping_status<>'NOT_APPLICABLE')
  );
