import { describe, it, expect } from 'vitest';
import { planEditImpact } from './remboursement-edit-impact';

describe('planEditImpact', () => {
  it('laisse le statut tel quel quand la demande est encore à traiter', () => {
    expect(planEditImpact('a_traiter')).toEqual({ allowed: true, resetStatusTo: null });
  });

  it('redescend à « à traiter » une demande validée par le trésorier', () => {
    // Les signatures portaient sur un autre contenu : la validation ne vaut
    // plus, et le trésorier doit pouvoir re-valider (sinon plus aucune
    // transition n'est possible — bug RBT-2026-030 du 2026-08-17).
    expect(planEditImpact('valide_tresorier')).toEqual({ allowed: true, resetStatusTo: 'a_traiter' });
  });

  it('redescend à « à traiter » une demande validée par le RG', () => {
    expect(planEditImpact('valide_rg')).toEqual({ allowed: true, resetStatusTo: 'a_traiter' });
  });

  it('rouvre une demande refusée que l’on corrige', () => {
    expect(planEditImpact('refuse')).toEqual({ allowed: true, resetStatusTo: 'a_traiter' });
  });

  it('refuse l’édition de fond quand le virement est déjà parti', () => {
    const r = planEditImpact('virement_effectue');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/virement/i);
  });

  it('refuse l’édition de fond d’une demande terminée', () => {
    expect(planEditImpact('termine').allowed).toBe(false);
  });

  it('refuse par défaut un statut inconnu plutôt que de deviner', () => {
    expect(planEditImpact('statut_bizarre').allowed).toBe(false);
  });
});
