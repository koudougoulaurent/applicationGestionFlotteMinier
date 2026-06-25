/**
 * utils.ts — Fonctions géographiques partagées entre les services IA
 * Exportées ici pour éviter la duplication entre RouteOptimizer, DispatchOptimizer, etc.
 */

/**
 * Distance entre deux coordonnées GPS en kilomètres.
 * Formule de Haversine — précision < 0.5% pour distances < 500 km.
 */
export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcule une régression linéaire simple sur une série de valeurs.
 * Retourne la pente (trend) : positif = augmentation, négatif = diminution.
 * Utile pour détecter la dérive des capteurs télémétrie.
 */
export function linearTrend(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  // Sommes pour la formule de la pente : (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
  const sumX  = values.reduce((s, _, i) => s + i, 0);
  const sumY  = values.reduce((s, v)    => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = values.reduce((s, _, i) => s + i * i, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/** Clamp une valeur entre un minimum et un maximum */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
