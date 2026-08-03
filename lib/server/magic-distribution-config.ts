export type MagicDistributionConfig = {
  timezone: "UTC";
  hour: number;
  minute: number;
};

function schedulePart(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be 0-${maximum}`);
  }
  return value;
}

export function getMagicDistributionConfig(): MagicDistributionConfig {
  const timezone = process.env.MAGIC_DISTRIBUTION_TIMEZONE || "UTC";
  if (timezone !== "UTC") throw new Error("MAGIC_DISTRIBUTION_TIMEZONE must be UTC");
  return {
    timezone,
    hour: schedulePart("MAGIC_DISTRIBUTION_HOUR", 6, 23),
    minute: schedulePart("MAGIC_DISTRIBUTION_MINUTE", 30, 59),
  };
}

export function isMagicDistributionDue(now: Date, config = getMagicDistributionConfig()) {
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= config.hour * 60 + config.minute;
}
