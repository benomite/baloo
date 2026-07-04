// Modèle de vue du panneau de détail d'une écriture. Pur : dérive du seul
// état comment le panneau doit se présenter. Cf. spec
// 2026-07-04-refonte-panneau-ecriture-design.md.
//
// - mode      : 'readonly' (mirror/divergent, non éditable) | 'edit-bank'
//               (brouillon issu de la banque : imputation faite sur la ligne,
//               panneau justif-first, identité démotée) | 'edit-manual'
//               (saisie main : l'identité redevient le travail).
// - editable  : les champs sync sont-ils modifiables localement.
// - primary   : action mise en avant dans la barre collante.
// - showIdentityInline : afficher les champs d'identité (date/type/montant/
//               n° pièce) directement, plutôt que derrière le menu ⋯.

export type PanelPrimary = 'valider' | 'sync' | 'copier-cw' | 'none';

export interface PanelViewModel {
  mode: 'edit-bank' | 'edit-manual' | 'readonly';
  editable: boolean;
  primary: PanelPrimary;
  showIdentityInline: boolean;
}

export function panelViewModel(ecriture: {
  status: string;
  ligne_bancaire_id: number | null;
  comptaweb_ecriture_id: number | null;
  type: 'depense' | 'recette';
  justif_attendu: number;
}): PanelViewModel {
  // Verrou sync : déjà dans Comptaweb (mirror) ou écart détecté (divergent).
  const locked = ecriture.status === 'mirror' || ecriture.status === 'divergent';
  if (locked) {
    return { mode: 'readonly', editable: false, primary: 'copier-cw', showIdentityInline: false };
  }

  const fromBank = ecriture.ligne_bancaire_id !== null;
  const mode = fromBank ? 'edit-bank' : 'edit-manual';

  let primary: PanelPrimary = 'none';
  if (ecriture.status === 'draft') primary = 'valider';
  else if (ecriture.status === 'pending_sync') primary = 'sync';

  return {
    mode,
    editable: true,
    primary,
    // Identité prioritaire seulement en saisie manuelle (montant = le travail) ;
    // pour la banque, l'identité vient du relevé → reléguée au menu ⋯.
    showIdentityInline: mode === 'edit-manual',
  };
}
