// Garde-fou anti-perte de donnée (Task 5) : le formulaire d'édition ne
// soumet plus les champs d'imputation (unité/catégorie/activité, migrés
// dans `ImputationGrid`). Ce test prouve que leur ABSENCE dans le FormData
// se traduit par `undefined` dans le patch (le service `updateEcriture`
// ignore un champ `undefined` — il ne l'écrase jamais en NULL), alors que
// leur présence (même vide) reste un effacement volontaire explicite.

import { describe, it, expect } from 'vitest';
import { buildEcriturePatchFromForm } from '../ecriture-form-patch';

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe('buildEcriturePatchFromForm', () => {
  it("unité/catégorie/activité ABSENTES du FormData (formulaire nettoyé Task 5) → undefined dans le patch", () => {
    const formData = makeFormData({
      date_ecriture: '2026-07-14',
      description: 'Achat fournitures',
      montant: '42,50',
      type: 'depense',
      mode_paiement_id: 'm1',
      carte_id: 'ca1',
      numero_piece: 'P1',
      notes: 'une note',
    });

    const patch = buildEcriturePatchFromForm(formData);

    expect(patch.unite_id).toBeUndefined();
    expect(patch.category_id).toBeUndefined();
    expect(patch.activite_id).toBeUndefined();
    // Les autres champs, eux, sont bien mappés normalement.
    expect(patch.date_ecriture).toBe('2026-07-14');
    expect(patch.description).toBe('Achat fournitures');
    expect(patch.amount_cents).toBe(4250);
    expect(patch.type).toBe('depense');
    expect(patch.mode_paiement_id).toBe('m1');
    expect(patch.carte_id).toBe('ca1');
    expect(patch.numero_piece).toBe('P1');
    expect(patch.notes).toBe('une note');
  });

  it('unité/catégorie/activité PRÉSENTES avec valeur → mappées normalement', () => {
    const formData = makeFormData({
      date_ecriture: '2026-07-14',
      description: 'Test',
      montant: '10,00',
      type: 'depense',
      unite_id: 'u1',
      category_id: 'c1',
      activite_id: 'a1',
    });

    const patch = buildEcriturePatchFromForm(formData);

    expect(patch.unite_id).toBe('u1');
    expect(patch.category_id).toBe('c1');
    expect(patch.activite_id).toBe('a1');
  });

  it('présentes mais vides → null explicite (distinct de "absentes")', () => {
    const formData = makeFormData({
      date_ecriture: '2026-07-14',
      description: 'Test',
      montant: '10,00',
      type: 'depense',
    });
    formData.set('unite_id', '');

    const patch = buildEcriturePatchFromForm(formData);

    expect(patch.unite_id).toBeNull();
    expect(patch.category_id).toBeUndefined();
  });

  it('justif_attendu : coché → 1, absent (checkbox décochée) → 0', () => {
    const base = {
      date_ecriture: '2026-07-14', description: 'Test', montant: '10,00', type: 'depense',
    };
    expect(buildEcriturePatchFromForm(makeFormData(base)).justif_attendu).toBe(0);

    const formData = makeFormData(base);
    formData.set('justif_attendu', 'on');
    expect(buildEcriturePatchFromForm(formData).justif_attendu).toBe(1);
  });
});
