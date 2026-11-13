import { describe, it, expect } from 'vitest';
import { renderFeuilleRemboursementPdf } from '../feuille-remboursement';
import { contenuLisiblePdf, sansEspaces } from './texte-pdf';
import type { Remboursement } from '../../types';
import type { RemboursementLigne } from '../../services/remboursements';

describe('renderFeuilleRemboursementPdf', () => {
  it('produit un buffer PDF non vide (%PDF)', async () => {
    const rbt: Remboursement = {
      id: 'RBT-TEST',
      group_id: 'GRP-TEST',
      demandeur: 'Jean Test',
      prenom: 'Jean',
      nom: 'Test',
      email: 'jean@ex.org',
      rib_texte: 'FR76 0000 0000 0000 0000 0000 000',
      rib_file_path: null,
      amount_cents: 4250,
      total_cents: 4250,
      date_depense: '2026-07-12',
      nature: 'Tickets métro',
      unite_id: null,
      justificatif_status: 'oui',
      status: 'a_traiter',
      motif_refus: null,
      date_paiement: null,
      mode_paiement_id: null,
      comptaweb_synced: 0,
      ecriture_id: null,
      notes: null,
      submitted_by_user_id: null,
      edit_token: null,
      validate_token: null,
      created_at: '2026-07-12T10:00:00.000Z',
      updated_at: '2026-07-12T10:00:00.000Z',
      unite_code: 'LOUV',
      mode_paiement_name: null,
    };

    const lignes: RemboursementLigne[] = [
      {
        id: 'L1',
        remboursement_id: 'RBT-TEST',
        date_depense: '2026-07-12',
        amount_cents: 4250,
        nature: 'Métro',
        notes: null,
        type: 'depense',
        distance_km_dixiemes: null,
        taux_km_millicents: null,
        created_at: '2026-07-12T10:00:00.000Z',
      },
    ];

    const buf = await renderFeuilleRemboursementPdf({
      rbt,
      lignes,
      groupName: 'Groupe Test',
      submittedAt: '2026-07-12',
      signatures: [],
    });

    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  // Ticket #43 : la copie d'archive ne doit laisser l'IBAN / BIC nulle part
  // dans le fichier. Le cas sans option est le témoin : il prouve que la
  // lecture du PDF retrouve bien l'IBAN quand il est imprimé.
  describe('masquerCoordonneesBancaires', () => {
    const IBAN = 'FR76 3000 6000 0112 3456 7890 189';
    const BIC = 'AGRIFRPP882';
    const rbt = {
      id: 'RBT-MASQ', group_id: 'g', demandeur: 'Jean Test', prenom: 'Jean', nom: 'Test',
      email: 'jean@ex.org', rib_texte: `${IBAN} / ${BIC}`, rib_file_path: null,
    } as unknown as Remboursement;
    const lignes = [{
      id: 'L1', remboursement_id: 'RBT-MASQ', date_depense: '2026-07-12', amount_cents: 4250,
      nature: 'Métro', notes: null, type: 'depense', distance_km_dixiemes: null,
      taux_km_millicents: null, created_at: '2026-07-12T10:00:00.000Z',
    }] as RemboursementLigne[];
    const rendre = (masquer?: boolean) => renderFeuilleRemboursementPdf({
      rbt, lignes, groupName: 'Groupe Test', submittedAt: '2026-07-12',
      masquerCoordonneesBancaires: masquer,
    });

    it('par défaut (feuille de l’app, envoi pour paiement), l’IBAN et le BIC sont imprimés', async () => {
      const contenu = contenuLisiblePdf(await rendre());
      expect(contenu).toContain(sansEspaces(IBAN));
      expect(contenu).toContain(BIC);
    });

    it('masqués : ni l’IBAN ni le BIC ne sont extractibles, la mention les remplace', async () => {
      const contenu = contenuLisiblePdf(await rendre(true));
      expect(contenu).not.toContain(sansEspaces(IBAN));
      expect(contenu).not.toContain('34567890189');
      expect(contenu).not.toContain(BIC);
      expect(contenu).toContain('IBAN/BIC');
      expect(contenu).toContain('masquédanscettecopie');
      expect(contenu).toContain('Métro');
    });
  });
});
