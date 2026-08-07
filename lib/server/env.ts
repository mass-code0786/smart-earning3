export function trimmedEnvValue(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export function canonicalUrlOrigin(value: string): string {
  return new URL(value.trim()).origin;
}

export function normalizedEnv(
  environment: NodeJS.ProcessEnv,
  keys: readonly string[],
): NodeJS.ProcessEnv {
  const normalized = { ...environment };
  for (const key of keys) {
    if (typeof normalized[key] === "string") normalized[key] = normalized[key]!.trim();
  }
  return normalized;
}
