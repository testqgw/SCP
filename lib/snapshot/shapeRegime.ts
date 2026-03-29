export function isLateSeasonDateEt(dateEt: string | null | undefined): boolean {
  if (!dateEt) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateEt.trim());
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return false;
  return month > 3 || (month === 3 && day >= 1);
}

function deriveStepUpRoleFlag(
  missingCoreShare: number | null | undefined,
  minutesLiftPct: number | null | undefined,
): boolean {
  return missingCoreShare != null && minutesLiftPct != null && missingCoreShare > 0.2 && minutesLiftPct >= 0.15;
}

export function deriveMinutesShiftAbsDelta(
  expectedMinutes: number | null | undefined,
  emaMinutesAvg: number | null | undefined,
): number | null {
  if (expectedMinutes == null || emaMinutesAvg == null) return null;
  return Math.abs(expectedMinutes - emaMinutesAvg);
}

export function shouldExposeShapeContext(input: {
  dateEt?: string | null;
  stepUpRoleFlag?: number | null;
  expectedMinutes?: number | null;
  emaMinutesAvg?: number | null;
  minutesShiftAbsDelta?: number | null;
  missingCoreShare?: number | null;
  minutesLiftPct?: number | null;
}): boolean {
  const lateSeason = isLateSeasonDateEt(input.dateEt);
  const stepUp =
    input.stepUpRoleFlag === 1 || deriveStepUpRoleFlag(input.missingCoreShare, input.minutesLiftPct);
  const minutesShock =
    input.minutesShiftAbsDelta != null
      ? input.minutesShiftAbsDelta >= 4
      : deriveMinutesShiftAbsDelta(input.expectedMinutes, input.emaMinutesAvg) != null &&
        (deriveMinutesShiftAbsDelta(input.expectedMinutes, input.emaMinutesAvg) as number) >= 4;
  return lateSeason || stepUp || minutesShock;
}

export function gateShapeNumber(value: number | null | undefined, enabled: boolean): number | null {
  return enabled && value != null && Number.isFinite(value) ? value : null;
}
