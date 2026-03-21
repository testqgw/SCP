type ProjectionField = "pointsProjection" | "reboundsProjection" | "assistProjection" | "threesProjection";
type ProjectionMarket = "PTS" | "REB" | "AST" | "THREES";

type ProjectionAwareRow = {
  market: string;
  projectedValue: number;
  pointsProjection?: number | null;
  reboundsProjection?: number | null;
  assistProjection?: number | null;
  threesProjection?: number | null;
};

const PROJECTION_FIELD_TO_MARKET: Record<ProjectionField, ProjectionMarket> = {
  pointsProjection: "PTS",
  reboundsProjection: "REB",
  assistProjection: "AST",
  threesProjection: "THREES",
};

export function getRowProjectionValue(row: ProjectionAwareRow, field: ProjectionField): number | null {
  const explicit = row[field];
  if (explicit != null && Number.isFinite(explicit)) return explicit;
  const fallbackMarket = PROJECTION_FIELD_TO_MARKET[field];
  if (row.market === fallbackMarket && Number.isFinite(row.projectedValue)) return row.projectedValue;
  return null;
}

export function meanProjection<T extends ProjectionAwareRow>(
  rows: T[],
  field: ProjectionField,
  roundValue: (value: number) => number,
): number | null {
  const valid = rows
    .map((row) => getRowProjectionValue(row, field))
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!valid.length) return null;
  return roundValue(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

export function rowProjectionOrSummary<T extends ProjectionAwareRow>(
  row: T,
  field: ProjectionField,
  summaryValue: number | null,
): number | null {
  return getRowProjectionValue(row, field) ?? summaryValue;
}
