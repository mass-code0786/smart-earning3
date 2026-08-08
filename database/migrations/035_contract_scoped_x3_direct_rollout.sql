-- Preserve the legacy singleton rollout while making alignment deployment-specific.
CREATE TABLE IF NOT EXISTS x3_direct_deployment_rollouts (
  chain_id bigint NOT NULL,
  contract_address varchar(42) NOT NULL,
  deployment_block bigint NOT NULL CHECK(deployment_block > 0),
  boundary_block_number bigint NOT NULL,
  boundary_log_index integer NOT NULL DEFAULT -1,
  mode varchar(24) NOT NULL CHECK(mode IN('TRANSITIONAL','CONTRACT_ALIGNED')),
  activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(chain_id,contract_address),
  CHECK(contract_address=lower(contract_address)),
  CHECK(boundary_block_number=deployment_block-1),
  CHECK(boundary_log_index=-1)
);

INSERT INTO x3_direct_deployment_rollouts(
  chain_id,contract_address,deployment_block,boundary_block_number,boundary_log_index,mode
) VALUES(
  97,'0xe8849043da1b0105f13cbdade8471d82e1847876',123687054,123687053,-1,'CONTRACT_ALIGNED'
)
ON CONFLICT(chain_id,contract_address) DO UPDATE SET
  deployment_block=EXCLUDED.deployment_block,
  boundary_block_number=EXCLUDED.boundary_block_number,
  boundary_log_index=-1,
  mode='CONTRACT_ALIGNED',
  activated_at=CASE
    WHEN x3_direct_deployment_rollouts.deployment_block<>EXCLUDED.deployment_block
      OR x3_direct_deployment_rollouts.boundary_block_number<>EXCLUDED.boundary_block_number
      OR x3_direct_deployment_rollouts.boundary_log_index<>-1
      OR x3_direct_deployment_rollouts.mode<>'CONTRACT_ALIGNED'
    THEN now() ELSE x3_direct_deployment_rollouts.activated_at END;
