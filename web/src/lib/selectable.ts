// Helpers pour filtrer les référentiels qu'on propose dans les
// dropdowns de saisie. Règle : seules les entrées mappées Comptaweb
// (comptaweb_id !== null) sont sélectionnables — les locales pures ne
// pourront jamais se synchroniser, on évite de générer de nouvelles
// écritures qui n'auraient aucun pendant côté Comptaweb.
//
// Exception : si l'écriture éditée pointe déjà vers une valeur orpheline
// (cas historique), on garde l'option dans la liste pour ne pas la
// perdre silencieusement à la sauvegarde. L'UI affiche alors un suffixe
// "(non sync)" pour signaler le statut au trésorier.

interface MappableItem {
  id: string;
  comptaweb_id: number | null;
}

export function keepSelectable<T extends MappableItem>(
  items: T[],
  currentId: string | null | undefined,
): T[] {
  const mapped = items.filter((i) => i.comptaweb_id !== null);
  if (!currentId) return mapped;
  if (mapped.some((i) => i.id === currentId)) return mapped;
  // La valeur courante est orpheline : on la préserve en tête.
  const orphan = items.find((i) => i.id === currentId);
  return orphan ? [orphan, ...mapped] : mapped;
}

export function isUnmapped(item: MappableItem): boolean {
  return item.comptaweb_id === null;
}
