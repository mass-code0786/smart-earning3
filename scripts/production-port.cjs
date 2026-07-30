const EXPECTED_NGINX_UPSTREAM_PORT = "3015";

function requireProductionPort(environment) {
  const configured = String(environment.PORT || "").trim();
  if (!configured) {
    throw new Error(
      `Production startup refused: PORT is required and must match Nginx upstream ${EXPECTED_NGINX_UPSTREAM_PORT}`,
    );
  }
  if (configured !== EXPECTED_NGINX_UPSTREAM_PORT) {
    throw new Error(
      `Production startup refused: PORT=${configured} does not match Nginx upstream ${EXPECTED_NGINX_UPSTREAM_PORT}`,
    );
  }
  return configured;
}

module.exports = {
  EXPECTED_NGINX_UPSTREAM_PORT,
  requireProductionPort,
};
