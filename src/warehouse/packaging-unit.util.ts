const PACKAGING_UNIT_LABEL: Record<string, [string, string]> = {
  PIECES: ['piece', 'pieces'],
  ROLLS: ['roll', 'rolls'],
  METERS: ['meter', 'meters'],
  SHEETS: ['sheet', 'sheets'],
};

/** "roll" / "rolls" for a PackagingUnit and a count. */
export function packagingUnitLabel(unit: string, count: number): string {
  const [one, many] = PACKAGING_UNIT_LABEL[unit] ?? ['item', 'items'];
  return count === 1 ? one : many;
}
