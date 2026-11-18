import type { CultureDto, LotDto } from '../../shared/cell-line';

/**
 * Cells per vial of the stock a culture descends from: the nearest lot up the lineage (thaw → lot, passage → parent,
 * frozen lot → its source culture) that recorded the number. Null when none did.
 */
export function sourceCellsPerVial(cultureId: string, cultures: CultureDto[], lots: LotDto[]): number | null {
  const seen = new Set<string>();
  let culture = cultures.find((c) => c.id === cultureId);
  while (culture && !seen.has(culture.id)) {
    seen.add(culture.id);
    if (culture.parentLotId) {
      const lot = lots.find((l) => l.id === culture!.parentLotId);
      if (lot?.cellsPerVial) return lot.cellsPerVial;
      culture = lot?.sourceCultureId ? cultures.find((c) => c.id === lot.sourceCultureId) : undefined;
    } else {
      culture = culture.parentCultureId ? cultures.find((c) => c.id === culture!.parentCultureId) : undefined;
    }
  }
  return null;
}
