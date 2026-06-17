// Frais kilométriques : helpers purs (sans BDD), importables côté serveur
// ET client. Unités : distance en dixièmes de km, taux en millièmes
// d'euro/km, montant en centimes.

// Parse une distance saisie ("12,5", "100", "12.5") en dixièmes de km.
// Lève si invalide ou <= 0.
export function parseDistanceToDixiemes(raw: string): number {
  const cleaned = raw.trim().replace(',', '.').replace(/\s/g, '');
  const km = Number(cleaned);
  if (cleaned === '' || !isFinite(km) || km <= 0) {
    throw new Error(`Distance invalide : « ${raw} »`);
  }
  return Math.round(km * 10);
}

// Montant en centimes = round(dixièmes de km × millièmes €/km / 100).
export function computeKmAmountCents(
  distanceKmDixiemes: number,
  tauxKmMillicents: number,
): number {
  return Math.round((distanceKmDixiemes * tauxKmMillicents) / 100);
}

// Affiche un taux (millièmes d'euro) en euros : 354 → "0,354 €".
export function formatKmRate(tauxKmMillicents: number): string {
  return `${(tauxKmMillicents / 1000).toFixed(3).replace('.', ',')} €`;
}

// Affiche une distance (dixièmes de km) en km : 1000 → "100 km", 125 → "12,5 km".
export function formatDistance(distanceKmDixiemes: number): string {
  const km = distanceKmDixiemes / 10;
  const txt = Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',');
  return `${txt} km`;
}
