const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const pluralize = (value: number, unit: string): string =>
  `${value} ${unit}${value === 1 ? "" : "s"}`;

export const formatDuration = (milliseconds: number): string => {
  const safeMilliseconds = Math.max(0, milliseconds);

  if (safeMilliseconds < SECOND_MS) {
    return "0s";
  }

  const days = Math.floor(safeMilliseconds / DAY_MS);
  const hours = Math.floor((safeMilliseconds % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((safeMilliseconds % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((safeMilliseconds % MINUTE_MS) / SECOND_MS);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
};

export const formatRelativeTime = (isoTimestamp: string, now: number): string => {
  const timestamp = new Date(isoTimestamp).getTime();

  if (Number.isNaN(timestamp)) {
    return "unknown";
  }

  const deltaMs = now - timestamp;
  const absoluteDeltaMs = Math.abs(deltaMs);
  const suffix = deltaMs >= 0 ? "ago" : "from now";

  if (absoluteDeltaMs < MINUTE_MS) {
    return `${pluralize(Math.max(1, Math.floor(absoluteDeltaMs / SECOND_MS)), "second")} ${suffix}`;
  }

  if (absoluteDeltaMs < HOUR_MS) {
    return `${pluralize(Math.floor(absoluteDeltaMs / MINUTE_MS), "minute")} ${suffix}`;
  }

  if (absoluteDeltaMs < DAY_MS) {
    return `${pluralize(Math.floor(absoluteDeltaMs / HOUR_MS), "hour")} ${suffix}`;
  }

  return `${pluralize(Math.floor(absoluteDeltaMs / DAY_MS), "day")} ${suffix}`;
};

export const formatTokenCount = (tokens: number): string =>
  new Intl.NumberFormat("en", {
    maximumFractionDigits: tokens >= 10_000 ? 1 : 0,
    notation: tokens >= 10_000 ? "compact" : "standard",
  }).format(tokens);
