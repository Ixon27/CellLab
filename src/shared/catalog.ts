export const CATALOG_CATEGORIES = [
  'base_medium', 'serum', 'supplement', 'antibiotic', 'dissociation', 'coating', 'freezing_medium', 'vessel', 'bank', 'antibody_diluent',
] as const;
export type CatalogCategory = typeof CATALOG_CATEGORIES[number];

export function isCatalogCategory(v: unknown): v is CatalogCategory {
  return typeof v === 'string' && (CATALOG_CATEGORIES as readonly string[]).includes(v);
}

export const CATALOG_LABELS: Record<CatalogCategory, string> = {
  base_medium: '기본 배지',
  serum: '혈청',
  supplement: '첨가물',
  antibiotic: '항생제',
  dissociation: '계대 시약',
  coating: '코팅',
  freezing_medium: '동결 배지',
  vessel: '배양 용기',
  bank: '분양처',
  antibody_diluent: '항체 희석액',
};

export interface CatalogOption {
  id: string;
  category: CatalogCategory;
  label: string;
  builtin: boolean;
  hidden: boolean;
}

export const BUILTIN_OPTIONS: Record<CatalogCategory, string[]> = {
  base_medium: [
    'DMEM (high glucose)', 'DMEM (low glucose)', 'DMEM/F-12', 'RPMI 1640', 'MEM (EMEM)', 'α-MEM', 'IMDM', "McCoy's 5A", "Ham's F-12",
    "Ham's F-12K (Kaighn's)", "Leibovitz's L-15", 'Medium 199', "Williams' Medium E", 'BME', 'Opti-MEM', 'Neurobasal', 'Keratinocyte-SFM',
    'EGM-2', 'mTeSR1', 'Essential 8',
  ],
  serum: [
    'FBS', 'Heat-inactivated FBS', 'Dialyzed FBS', 'Charcoal-stripped FBS', 'Calf serum', 'Newborn calf serum', 'Horse serum', 'Human serum',
    'Serum-free',
  ],
  supplement: [
    'L-glutamine', 'GlutaMAX', 'NEAA', 'Sodium pyruvate', 'HEPES', 'Sodium bicarbonate', 'ITS (Insulin-Transferrin-Selenium)', 'Insulin',
    'Hydrocortisone', 'EGF', 'bFGF', 'β-mercaptoethanol', 'Puromycin', 'G418', 'Hygromycin B', 'Blasticidin',
  ],
  antibiotic: ['Penicillin-Streptomycin', 'Antibiotic-Antimycotic', 'Gentamicin', 'Amphotericin B', 'Normocin', 'Plasmocin', '사용 안 함'],
  dissociation: [
    'Trypsin-EDTA 0.25%', 'Trypsin-EDTA 0.05%', 'TrypLE Express', 'Accutase', 'Versene (EDTA)', 'Dispase', 'Collagenase', 'Cell scraper',
    '원심분리 (부유세포)',
  ],
  coating: ['사용 안 함', 'Poly-L-lysine', 'Poly-D-lysine', 'Gelatin 0.1%', 'Collagen I', 'Fibronectin', 'Laminin', 'Vitronectin', 'Matrigel'],
  freezing_medium: [
    '90% FBS + 10% DMSO', '70% medium + 20% FBS + 10% DMSO', 'Complete medium + 5% DMSO', 'CryoStor CS10', 'Bambanker', 'CELLBANKER 1',
  ],
  vessel: [
    'T25', 'T75', 'T175', '35 mm dish', '60 mm dish', '100 mm dish', '150 mm dish', '6-well', '12-well', '24-well', '48-well', '96-well',
    'Cryovial',
  ],
  bank: ['ATCC', 'KCLB', 'DSMZ', 'ECACC', 'JCRB', 'RIKEN BRC', 'CLS', '타 연구실 분양', '자체 제작'],
  antibody_diluent: ['5% BSA/TBST', '5% skim milk/TBST', '3% BSA/TBST', '상용 희석액'],
};

/** Growth area per vessel (Corning reference; differs by manufacturer). */
export const VESSEL_AREA_CM2: Record<string, number> = {
  T25: 25,
  T75: 75,
  T175: 175,
  '35 mm dish': 8.0,
  '60 mm dish': 21,
  '100 mm dish': 55,
  '150 mm dish': 145,
  '6-well': 9.5,
  '12-well': 3.8,
  '24-well': 1.9,
  '48-well': 0.95,
  '96-well': 0.32,
};

/** Cell bank (catalog label) → Cellosaurus provider database name. */
export const BANK_TO_DATABASE: Record<string, string> = {
  ATCC: 'ATCC',
  KCLB: 'KCLB',
  DSMZ: 'DSMZ',
  ECACC: 'ECACC',
  JCRB: 'JCRB',
  'RIKEN BRC': 'RCB',
  CLS: 'CLS',
};
