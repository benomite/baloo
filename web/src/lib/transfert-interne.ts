// Transfert interne (#51) — règles pures partagées par le panneau d'écriture,
// les server actions et le MCP. Un brouillon bancaire a une « nature » :
// dépense, recette, ou l'un des trois modes de transfert interne (le mode de
// transaction Comptaweb du formulaire « Transfert interne à la structure »).

import { TERMS } from './glossary';
import {
  MODES_TRANSFERT,
  isModeTransfert,
  type DepotEspeces,
  type EcritureType,
  type ModeTransfert,
  type MouvementCaisse,
} from './types';
import type { OperationCaisseLiee } from './services/caisse';

// Libellés Comptaweb du mode de transaction d'un transfert interne, tels que
// le trésorier les choisit dans le formulaire « Transfert interne à la
// structure » (cf. ticket #51).
export const MODE_TRANSFERT_CW_LABELS: Record<ModeTransfert, string> = {
  depot_especes: 'Caisse (dépôt)',
  retrait_especes: 'Caisse (retrait)',
  transfert_especes: 'Caisse (transfert)',
};

export type NatureEcriture ='depense' | 'recette' | ModeTransfert;

export const NATURES_ECRITURE: ReadonlyArray<{ value: NatureEcriture; label: string }> = [
  { value: 'depense', label: 'Dépense' },
  { value: 'recette', label: 'Recette' },
  ...MODES_TRANSFERT.map((m) => ({ value: m, label: libelleTransfert(m) })),
];

// Libellé d'un transfert interne dans les listes : « Transfert interne —
// Dépôt d'espèces (caisse → banque) », ou juste « Transfert interne » tant
// que le mode n'est pas choisi.
export function libelleTransfert(mode: ModeTransfert | null | undefined): string {
  return mode
    ? `${TERMS.transfertInterne.singular} — ${TERMS.transfertInterne.modes[mode]}`
    : TERMS.transfertInterne.singular;
}

// Nature affichée d'une écriture. Un transfert interne sans mode (qualifié
// mais pas encore précisé) n'a pas de nature sélectionnable : '' (le select
// montre alors « Choisir le mode »).
export function natureDeEcriture(e: { type: EcritureType; mode_transfert?: ModeTransfert | null }): NatureEcriture | '' {
  if (e.type === 'transfert_interne') return e.mode_transfert ?? '';
  return e.type;
}

// Patch `updateEcriture` d'une nature choisie. Lève sur une valeur inconnue
// (une server action reçoit une chaîne du client).
export function patchDeNature(nature: string): { type: EcritureType; mode_transfert: ModeTransfert | null } {
  if (nature === 'depense' || nature === 'recette') return { type: nature, mode_transfert: null };
  if (isModeTransfert(nature)) return { type: 'transfert_interne', mode_transfert: nature };
  throw new Error(`Nature d'écriture inconnue : ${nature}.`);
}

// Opération de caisse qui reflète un transfert interne : un dépôt (caisse →
// banque) ou un retrait (banque → caisse). Le transfert d'espèces n'a pas de
// mouvement de caisse Baloo à lier.
// Une opération de caisse ramenée à ce que le panneau affiche : id, date,
// montant (positif). Dépôt → sa date de dépôt et son total ; retrait → son
// mouvement.
export interface OperationCaisseVue {
  id: string;
  date: string;
  amountCents: number;
}

export function vueDepot(d: DepotEspeces): OperationCaisseVue {
  return { id: d.id, date: d.date_depot, amountCents: d.total_amount_cents };
}

export function vueRetrait(m: MouvementCaisse): OperationCaisseVue {
  return { id: m.id, date: m.date_mouvement, amountCents: Math.abs(m.amount_cents) };
}

export function vueOperationLiee(liee: OperationCaisseLiee): OperationCaisseVue {
  return liee.kind === 'depot' ? vueDepot(liee.depot) : vueRetrait(liee.mouvement);
}

export function operationCaisseDuMode(mode: ModeTransfert | null | undefined): 'depot' | 'retrait' | null {
  if (mode === 'depot_especes') return 'depot';
  if (mode === 'retrait_especes') return 'retrait';
  return null;
}
