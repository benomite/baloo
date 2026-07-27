import { describe, it, expect } from 'vitest';
import { renderFeuilleRemboursementPdf } from '../feuille-remboursement';
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
});
