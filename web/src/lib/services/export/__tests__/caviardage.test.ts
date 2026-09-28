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

  it('retire IBAN et BIC d`un compte bancaire', () => {
    const compte = {
      id: 'COMPTE-1',
      code: 'CHEC',
      nom: 'Compte chèques',
      banque: 'Crédit Mutuel',
      comptaweb_id: 'CW-789',
      iban: 'FR7630004000051234567890143',
      bic: 'CMCIFR2A',
    };
    const c = caviarder('comptes_bancaires', compte);
    expect(c).not.toHaveProperty('iban');
    expect(c).not.toHaveProperty('bic');
  });

  it('conserve les champs d`identification du compte', () => {
    const compte = {
      id: 'COMPTE-1',
      code: 'CHEC',
      nom: 'Compte chèques',
      banque: 'Crédit Mutuel',
      comptaweb_id: 'CW-789',
      iban: 'FR7630004000051234567890143',
      bic: 'CMCIFR2A',
    };
    const c = caviarder('comptes_bancaires', compte);
    expect(c.code).toBe('CHEC');
    expect(c.nom).toBe('Compte chèques');
    expect(c.banque).toBe('Crédit Mutuel');
    expect(c.comptaweb_id).toBe('CW-789');
  });

  it('ne laisse aucun IBAN dans la sortie sérialisée d`un compte', () => {
    const compte = {
      id: 'COMPTE-1',
      code: 'CHEC',
      iban: 'FR7630004000051234567890143',
      bic: 'CMCIFR2A',
    };
    const serialise = JSON.stringify(caviarder('comptes_bancaires', compte));
    expect(serialise).not.toContain('FR76');
    expect(serialise).not.toContain('CMCIFR2A');
  });

  it('retire iban_principal d`un groupe', () => {
    const groupe = {
      id: 'GRP-1',
      nom: 'Groupe des Castors',
      email_contact: 'tresorier@castors.fr',
      iban_principal: 'FR7630004000051234567890143',
    };
    const g = caviarder('groupes', groupe);
    expect(g).not.toHaveProperty('iban_principal');
  });

  it('conserve les champs d`identification du groupe', () => {
    const groupe = {
      id: 'GRP-1',
      nom: 'Groupe des Castors',
      email_contact: 'tresorier@castors.fr',
      iban_principal: 'FR7630004000051234567890143',
    };
    const g = caviarder('groupes', groupe);
    expect(g.nom).toBe('Groupe des Castors');
    expect(g.email_contact).toBe('tresorier@castors.fr');
  });

  it('ne laisse aucun IBAN dans la sortie sérialisée d`un groupe', () => {
    const groupe = {
      id: 'GRP-1',
      nom: 'Groupe des Castors',
      iban_principal: 'FR7630004000051234567890143',
    };
    const serialise = JSON.stringify(caviarder('groupes', groupe));
    expect(serialise).not.toContain('FR76');
  });

  it('retire le téléphone d`une personne, conserve le reste', () => {
    const personne = {
      id: 'PERS-1',
      prenom: 'Julie',
      nom: 'Martin',
      email: 'julie.martin@example.org',
      telephone: '06 12 34 56 78',
      role_groupe: 'tresoriere',
    };
    const p = caviarder('personnes', personne);
    expect(p).not.toHaveProperty('telephone');
    expect(p.prenom).toBe('Julie');
    expect(p.nom).toBe('Martin');
    expect(p.email).toBe('julie.martin@example.org');
    expect(p.role_groupe).toBe('tresoriere');
    expect(JSON.stringify(p)).not.toContain('06 12 34 56 78');
  });
});
