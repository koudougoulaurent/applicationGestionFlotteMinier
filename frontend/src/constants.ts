// ─────────────────────────────────────────────────────────────
// Tokens de style globaux
// ─────────────────────────────────────────────────────────────
export const T = {
  bg:      '#0f1117',
  card:    '#161922',
  border:  '#252a38',
  border2: '#1a1d26',
  text:    '#d4d8e2',
  sub:     '#6b7280',
  faint:   '#374151',
  amber:   '#f59e0b',
} as const;

// ─────────────────────────────────────────────────────────────
// Zones / Minerais
// ─────────────────────────────────────────────────────────────
export const MINERAL: Record<string, { label: string; color: string }> = {
  MINERAL_CUIVRE: { label: 'Cuivre',   color: '#3b82f6' },
  MINERAL_COBALT: { label: 'Cobalt',   color: '#8b5cf6' },
  STERIL:         { label: 'Stériles', color: '#6b7280' },
  MIXTE:          { label: 'Mixte',    color: '#f59e0b' },
};

export const MATERIAUX: Record<string, string[]> = {
  MINERAL_CUIVRE: ['Minerai de cuivre oxydé','Minerai de cuivre sulfuré','Minerai mixte Cu','Minerai pauvre cuivre'],
  MINERAL_COBALT: ['Minerai de cobalt','Hétérogenite','Minerai mixte Co-Cu','Minerai pauvre cobalt'],
  STERIL:         ['Stérile — granite','Stérile — schiste','Stérile — argile','Mort-terrain'],
  MIXTE:          ['Minerai mixte','Mixte basse teneur','Minerai de transition'],
};

// ─────────────────────────────────────────────────────────────
// Dumps / Points de décharge
// ─────────────────────────────────────────────────────────────
export const DUMP_TYPE: Record<string, { label: string; color: string }> = {
  CRUSHEUR:      { label: 'Crusheur',  color: '#f97316' },
  DUMP:          { label: 'Dump',      color: '#6b7280' },
  STOCK_MINERAI: { label: 'Stock',     color: '#22c55e' },
  REMBLAI:       { label: 'Remblai',   color: '#8b5cf6' },
};

// ─────────────────────────────────────────────────────────────
// Statuts
// ─────────────────────────────────────────────────────────────
export const STATUT_ENGIN: Record<string, { label: string; color: string }> = {
  DISPONIBLE:    { label: 'Disponible',   color: '#22c55e' },
  EN_ATTENTE:    { label: 'En attente',   color: '#f59e0b' },
  EN_CHARGEMENT: { label: 'Chargement',   color: '#f97316' },
  EN_ROUTE:      { label: 'En route',     color: '#3b82f6' },
  AU_DUMP:       { label: 'Au dump',      color: '#f97316' },
  EN_RETOUR:     { label: 'Retour',       color: '#8b5cf6' },
  EN_PANNE:      { label: 'En panne',     color: '#ef4444' },
  PAUSE:         { label: 'Pause',        color: '#6b7280' },
};

export const STATUT_VOYAGE: Record<string, { label: string; color: string }> = {
  EN_ATTENTE:    { label: 'En attente',   color: '#6b7280' },
  EN_CHARGEMENT: { label: 'Chargement',   color: '#f97316' },
  EN_ROUTE:      { label: 'En route',     color: '#3b82f6' },
  AU_DUMP:       { label: 'Au dump',      color: '#f97316' },
  EN_RETOUR:     { label: 'Retour',       color: '#8b5cf6' },
  COMPLETE:      { label: 'Terminé',      color: '#22c55e' },
  ANNULE:        { label: 'Annulé',       color: '#ef4444' },
};

export const STATUTS_ACTIFS = ['EN_ATTENTE','EN_CHARGEMENT','EN_ROUTE','AU_DUMP','EN_RETOUR'] as const;
