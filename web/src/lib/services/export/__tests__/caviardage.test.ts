import { describe, it, expect } from 'vitest';
import { caviarder, CHAMPS_SENSIBLES } from '../caviardage';

describe('caviarder', () => {
  const remb = {
    id: 'REMB-1',
    demandeur: 'Pierre',
    email: 'pierre@example.org',
    rib_texte: 'FR76 3000 4000 0512 3456 7890 143',
    rib_file_path: 'blob/rib/REMB-1.pdf',
    edit_token: 'tok_edit_abc123',
    validate_token: 'tok_val_def456',
    total_cents: 4200,
  };

  it('retire RIB et tokens d`un remboursement', () => {
    const r = caviarder('remboursements', remb);
    expect(r).not.toHaveProperty('rib_texte');
    expect(r).not.toHaveProperty('rib_file_path');
    expect(r).not.toHaveProperty('edit_token');
    expect(r).not.toHaveProperty('validate_token');
  });

  it('conserve les champs nécessaires à la lecture de l`archive', () => {
    const r = caviarder('remboursements', remb);
    expect(r.id).toBe('REMB-1');
    expect(r.demandeur).toBe('Pierre');
    expect(r.total_cents).toBe(4200);
    // L'email reste : un successeur doit pouvoir recontacter le demandeur.
    expect(r.email).toBe('pierre@example.org');
  });

  it('ne laisse aucune valeur sensible dans la sortie sérialisée', () => {
    const serialise = JSON.stringify(caviarder('remboursements', remb));
    expect(serialise).not.toContain('FR76');
    expect(serialise).not.toContain('tok_edit_abc123');
    expect(serialise).not.toContain('tok_val_def456');
    expect(serialise).not.toContain('blob/rib');
  });

  it('retire la clé au lieu de la mettre à null', () => {
    const r = caviarder('remboursements', remb);
    expect(Object.keys(r)).not.toContain('rib_texte');
  });

  it('laisse intacte une table sans champ sensible', () => {
    const ecr = { id: 'ECR-1', description: 'Intermarché', amount_cents: 8777 };
    expect(caviarder('ecritures', ecr)).toEqual(ecr);
  });

  it('déclare au moins les quatre champs sensibles des remboursements', () => {
    expect(CHAMPS_SENSIBLES.remboursements.sort()).toEqual(
      ['edit_token', 'rib_file_path', 'rib_texte', 'validate_token'],
    );
  });
});
