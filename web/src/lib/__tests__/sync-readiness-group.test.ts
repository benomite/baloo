import { describe, it, expect } from 'vitest';
import { computeGroupReadiness } from '../sync-readiness';
import type { Ecriture, Category, Unite, ModePaiement, Activite } from '../types';

const categories = [{ id: 'cat-a', comptaweb_id: 1 }] as Category[];
const unites = [{ id: 'u-a', comptaweb_id: 2 }] as Unite[];
const activites = [{ id: 'act-a', comptaweb_id: 3 }] as Activite[];
const modesPaiement = [{ id: 'mp-virement', comptaweb_id: 4 }] as ModePaiement[];
const refs = { categories, unites, modesPaiement, activites };

function ecr(over: Partial<Ecriture>): Ecriture {
  return {
    id: 'E', group_id: 'g', date_ecriture: '2026-07-20', description: 'x', amount_cents: 1000,
    type: 'depense', status: 'draft', category_id: 'cat-a', unite_id: 'u-a', activite_id: 'act-a',
    mode_paiement_id: 'mp-virement', carte_id: null, numero_piece: null, justif_attendu: 1,
    comptaweb_synced: 0, comptaweb_ecriture_id: null, ventilation_group_id: 'vg1',
    ligne_bancaire_id: null, ligne_bancaire_sous_index: null, libelle_origine: null, notes: null,
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
    ...over,
  } as Ecriture;
}

describe('computeGroupReadiness — un groupe de ventilation = UNE pièce Comptaweb', () => {
  // Le mode de paiement est un champ d'EN-TÊTE de pièce : `syncDraftToComptaweb`
  // ne lit que celui de la ligne cliquée (la tête) et envoie N ventilations
  // (montant/nature/activité/branche). Le juger membre par membre bloquait la
  // validation à tort — cas réel prod 2026-07-27 (virement groupé MERSCH : mode
  // posé sur la tête, absent des 3 dernières lignes → « Valider » grisé alors
  // que le panneau affichait « Prête »).
  it('mode de paiement porté par la seule tête → groupe prêt', () => {
    const r = computeGroupReadiness(
      [
        ecr({ id: 'T', mode_paiement_id: 'mp-virement' }),
        ecr({ id: 'C1', mode_paiement_id: null }),
        ecr({ id: 'C2', mode_paiement_id: null }),
      ],
      refs,
    );
    expect(r.level).toBe('ready');
    expect(r.missingFields).toEqual([]);
  });

  it('mode absent de la tête → incomplet, une seule fois', () => {
    const r = computeGroupReadiness(
      [ecr({ id: 'T', mode_paiement_id: null }), ecr({ id: 'C1', mode_paiement_id: null })],
      refs,
    );
    expect(r.level).toBe('incomplete');
    expect(r.missingFields).toEqual(['mode de paiement']);
  });

  it('imputation manquante sur un enfant → incomplet, ligne identifiée', () => {
    const r = computeGroupReadiness(
      [ecr({ id: 'T' }), ecr({ id: 'C1', category_id: null }), ecr({ id: 'C2' })],
      refs,
    );
    expect(r.level).toBe('incomplete');
    expect(r.missingFields).toEqual(['Ventilation 2 — catégorie']);
  });

  it('mono-ligne : strictement le même verdict que computeReadiness', () => {
    const solo = ecr({ id: 'S', ventilation_group_id: null, activite_id: null });
    const r = computeGroupReadiness([solo], refs);
    expect(r.level).toBe('incomplete');
    expect(r.missingFields).toEqual(['activité']);
  });

  it('déjà dans Comptaweb → synced', () => {
    const r = computeGroupReadiness([ecr({ id: 'T', comptaweb_ecriture_id: 987 }), ecr({ id: 'C1' })], refs);
    expect(r.level).toBe('synced');
  });
});
