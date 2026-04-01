const EASTERN_TZ = "America/New_York";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function getTodayEtDateString(reference = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function formatUtcToEt(utcDate: Date | null): string {
  if (!utcDate) {
    return "TBD";
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(utcDate);
}

export function formatIsoToEtTime(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function etDateShift(baseEtDate: string, deltaDays: number): string {
  const [year, month, day] = baseEtDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
}

export function inferSeasonFromEtDate(dateEt: string): string {
  const [year, month] = dateEt.split("-").map(Number);
  if (month >= 10) {
    return `${year}`;
  }
  return `${year - 1}`;
}
