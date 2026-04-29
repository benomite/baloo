// Helpers pour parser les FormData côté server actions.
//
// Piège récurrent : `formData.get('foo')` retourne `""` (chaîne vide)
// quand un <select> avec option vide est laissé sur cette option, ou
// qu'un <input> texte est vidé. Si on passe ce `""` à un INSERT SQL
// dont la colonne est une FK, on déclenche `FOREIGN KEY constraint
// failed` parce que `""` n'est pas reconnu comme NULL.
//
// Règle : pour TOUT champ FK (unite_id, category_id, mode_paiement_id,
// activite_id, carte_id, scope_unite_id, ecriture_id, person_id, ...)
// utiliser `formStringOrNull` qui convertit `""` et whitespace-only
// en `null`. Ne JAMAIS utiliser `?? null` (ça ne traite que
// null/undefined, pas `""`).

export function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

export function formStringOrNull(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function formInt(formData: FormData, key: string, defaultValue = 0): number {
  const v = formStringOrNull(formData, key);
  if (!v) return defaultValue;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

export function formBool(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return v === 'on' || v === '1' || v === 'true';
}

// Normalise une valeur quelconque : `""` → `null`. Utile aux services
// qui reçoivent un input typed (`string | null | undefined`) en
// défense en profondeur.
export function nullIfEmpty<T>(value: T | string): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  return value as T;
}
