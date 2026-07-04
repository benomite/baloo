// Modèle de vue du panneau d'écriture : dérive le mode d'affichage, la
// mutabilité, l'action primaire et la priorité de l'identité à partir du
// seul état de l'écriture. Pur → testable sans rendu.

import { describe, it, expect } from 'vitest';
import { panelViewModel } from '../panel-view-model';

type E = Parameters<typeof panelViewModel>[0];
const base: E = {
  status: 'draft',
  ligne_bancaire_id: null,
  comptaweb_ecriture_id: null,
  type: 'depense',
  justif_attendu: 1,
};

describe('panelViewModel', () => {
  it('mirror → lecture seule, non éditable, action « copier CW »', () => {
    const vm = panelViewModel({ ...base, status: 'mirror', comptaweb_ecriture_id: 42 });
    expect(vm.mode).toBe('readonly');
    expect(vm.editable).toBe(false);
    expect(vm.primary).toBe('copier-cw');
    expect(vm.showIdentityInline).toBe(false);
  });

  it('divergent → lecture seule aussi', () => {
    const vm = panelViewModel({ ...base, status: 'divergent', comptaweb_ecriture_id: 42 });
    expect(vm.mode).toBe('readonly');
    expect(vm.editable).toBe(false);
  });

  it('brouillon issu de la banque → edit-bank, identité démotée, action « valider »', () => {
    const vm = panelViewModel({ ...base, status: 'draft', ligne_bancaire_id: 19102436 });
    expect(vm.mode).toBe('edit-bank');
    expect(vm.editable).toBe(true);
    expect(vm.primary).toBe('valider');
    expect(vm.showIdentityInline).toBe(false); // banque → identité derrière ⋯
  });

  it('brouillon saisi à la main → edit-manual, identité prioritaire', () => {
    const vm = panelViewModel({ ...base, status: 'draft', ligne_bancaire_id: null });
    expect(vm.mode).toBe('edit-manual');
    expect(vm.editable).toBe(true);
    expect(vm.primary).toBe('valider');
    expect(vm.showIdentityInline).toBe(true); // saisie manuelle → identité = le travail
  });

  it('pending_sync (pas encore dans CW) → éditable, action « sync »', () => {
    const vm = panelViewModel({ ...base, status: 'pending_sync', ligne_bancaire_id: 19102436 });
    expect(vm.editable).toBe(true);
    expect(vm.mode).toBe('edit-bank');
    expect(vm.primary).toBe('sync');
  });

  it('statut terminal (agrege_remplace) → pas d\'action primaire', () => {
    const vm = panelViewModel({ ...base, status: 'agrege_remplace' });
    expect(vm.primary).toBe('none');
  });
});
