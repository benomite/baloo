// Traduction FormData → `UpdateEcritureInput`, extraite de la server action
// `updateEcriture` (fichier 'use server') pour être testable en dehors du
// runtime Next (cf. AGENTS.md "Modules purs pour les transitions de
// workflow" : même logique appliquée ici au mapping FormData).
//
// GARDE-FOU anti-perte de donnée (Task 5, nettoyage `EcritureForm` — cf.
// .superpowers/sdd/task-5-brief.md) : l'imputation (unité/catégorie/
// activité) a migré dans `ImputationGrid` et n'est PLUS soumise par ce
// formulaire. `formData.get(key)` renvoie `null` aussi bien quand la clé
// est ABSENTE que quand elle est présente mais vide — un mapping
// inconditionnel (`formData.get(x) || null`) écraserait donc l'imputation
// existante en NULL à chaque save (`updateEcriture` service traite
// `undefined` comme "ne pas toucher" mais `null` comme "effacer", cf.
// `lib/services/ecritures.ts`). On distingue donc explicitement :
//   - clé ABSENTE du FormData → `undefined` (le service ignore le champ) ;
//   - clé présente (même vide)  → `null` ou la valeur (effacement volontaire
//     assumé, ex. pour un futur appelant qui voudrait vider `numero_piece`).
import { parseAmount } from '../format';
import type { UpdateEcritureInput } from '../services/ecritures';

function presentOrUndefined(formData: FormData, key: string): string | null | undefined {
  if (!formData.has(key)) return undefined;
  return (formData.get(key) as string) || null;
}

export function buildEcriturePatchFromForm(formData: FormData): UpdateEcritureInput {
  return {
    date_ecriture: formData.get('date_ecriture') as string,
    description: formData.get('description') as string,
    amount_cents: parseAmount(formData.get('montant') as string),
    type: formData.get('type') as 'depense' | 'recette',
    // Imputation : absente du FormData depuis Task 5 (vit dans
    // `ImputationGrid`) → `undefined`, jamais écrasée.
    unite_id: presentOrUndefined(formData, 'unite_id'),
    category_id: presentOrUndefined(formData, 'category_id'),
    activite_id: presentOrUndefined(formData, 'activite_id'),
    mode_paiement_id: presentOrUndefined(formData, 'mode_paiement_id'),
    numero_piece: presentOrUndefined(formData, 'numero_piece'),
    carte_id: presentOrUndefined(formData, 'carte_id'),
    justif_attendu: formData.has('justif_attendu') ? 1 : 0,
    notes: presentOrUndefined(formData, 'notes'),
  };
}
