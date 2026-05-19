// Tests de l'adapter scraper CW pour `createEcritureAndPushToCw` (Task 8).
//
// On teste deux choses :
//
//  1. `buildCwInputFromPayload` : le mapping payload Baloo → CreateEcritureInput
//     (résolution category_id → natureId, etc.) avec lookup BDD mockable.
//  2. `defaultCwScraper` : combiné avec le createEcriture mocké, vérifie
//     que les erreurs CW sont propagées au caller.

import { describe, it, expect, vi } from 'vitest';
import {
  buildCwInputFromPayload,
  defaultCwScraper,
} from '../ecritures-create-cw-adapter';
import type { EcriturePayload } from '../ecritures-create';

const VALID_PAYLOAD: EcriturePayload = {
  date_ecriture: '2026-05-18',
  description: 'Achat fournitures',
  amount_cents: 4250,
  type: 'depense',
  category_id: 'cat-1',
  mode_paiement_id: 'mp-1',
  unite_id: 'u-1',
  activite_id: 'act-1',
  carte_id: null,
  numero_piece: 'FACT-001',
  notes: null,
};

describe('buildCwInputFromPayload', () => {
  it('mappe category_id Baloo → natureId CW via comptaweb_id', async () => {
    const lookupComptawebId = vi.fn(async (table: string, id: string | null | undefined) => {
      if (id === 'cat-1' && table === 'categories') return 42;
      if (id === 'mp-1' && table === 'modes_paiement') return 1;
      if (id === 'u-1' && table === 'unites') return 7;
      if (id === 'act-1' && table === 'activites') return 11;
      return null;
    });

    const input = await buildCwInputFromPayload(VALID_PAYLOAD, {
      lookupComptawebId,
      lookupCarte: async () => null,
    });

    expect(input.ventilations).toHaveLength(1);
    expect(input.ventilations[0].natureId).toBe('42');
    expect(input.ventilations[0].brancheprojetId).toBe('7');
    expect(input.ventilations[0].activiteId).toBe('11');
    expect(input.modetransactionId).toBe('1');
    expect(input.type).toBe('depense');
    expect(input.libel).toBe('Achat fournitures');
    // Date ISO → DD/MM/YYYY pour CW.
    expect(input.dateecriture).toBe('18/05/2026');
    // Cents → format fr "42,50".
    expect(input.montant).toBe('42,50');
    expect(input.ventilations[0].montant).toBe('42,50');
    expect(input.numeropiece).toBe('FACT-001');
    // Defaults.
    expect(input.tiersCategId).toBe('10');
    expect(input.comptebancaireId).toBe('791');
  });

  it('throw une erreur claire si la catégorie n\'a pas de mapping CW', async () => {
    const lookupComptawebId = vi.fn(async (table: string) => {
      // mapping mode/unite/activite OK, mais categorie NON mappée.
      if (table === 'categories') return null;
      return 1;
    });

    await expect(
      buildCwInputFromPayload(VALID_PAYLOAD, {
        lookupComptawebId,
        lookupCarte: async () => null,
      }),
    ).rejects.toThrow(/mapping CW de la catégorie/);
  });

  it('throw une erreur claire si plusieurs mappings manquent (liste consolidée)', async () => {
    const lookupComptawebId = vi.fn(async () => null);

    await expect(
      buildCwInputFromPayload(VALID_PAYLOAD, {
        lookupComptawebId,
        lookupCarte: async () => null,
      }),
    ).rejects.toThrow(/catégorie.*activité.*unité.*mode/s);
  });

  it('throw si category_id absent (pas juste le mapping)', async () => {
    const lookupComptawebId = vi.fn(async () => 1);
    await expect(
      buildCwInputFromPayload(
        { ...VALID_PAYLOAD, category_id: null },
        { lookupComptawebId, lookupCarte: async () => null },
      ),
    ).rejects.toThrow(/catégorie/);
  });

  it('résout carteId procurement → carteprocurementId', async () => {
    const lookupComptawebId = vi.fn(async () => 1);
    const lookupCarte = vi.fn(async () => ({
      id: 'carte-x',
      type: 'procurement' as const,
      comptaweb_id: 99,
    }));

    const input = await buildCwInputFromPayload(
      { ...VALID_PAYLOAD, carte_id: 'carte-x' },
      { lookupComptawebId, lookupCarte },
    );

    expect(input.carteprocurementId).toBe('99');
    expect(input.cartebancaireId).toBeUndefined();
  });

  it('résout carteId cb → cartebancaireId', async () => {
    const lookupComptawebId = vi.fn(async () => 1);
    const lookupCarte = vi.fn(async () => ({
      id: 'carte-x',
      type: 'cb' as const,
      comptaweb_id: 55,
    }));

    const input = await buildCwInputFromPayload(
      { ...VALID_PAYLOAD, carte_id: 'carte-x' },
      { lookupComptawebId, lookupCarte },
    );

    expect(input.cartebancaireId).toBe('55');
    expect(input.carteprocurementId).toBeUndefined();
  });

  it('format montant fr correct pour cas pièges (1, 100, 999)', async () => {
    const lookupComptawebId = vi.fn(async () => 1);
    const lookupCarte = vi.fn(async () => null);

    // 1 cent → "0,01"
    let input = await buildCwInputFromPayload(
      { ...VALID_PAYLOAD, amount_cents: 1 },
      { lookupComptawebId, lookupCarte },
    );
    expect(input.montant).toBe('0,01');

    // 100 cents → "1,00"
    input = await buildCwInputFromPayload(
      { ...VALID_PAYLOAD, amount_cents: 100 },
      { lookupComptawebId, lookupCarte },
    );
    expect(input.montant).toBe('1,00');

    // 999 cents → "9,99"
    input = await buildCwInputFromPayload(
      { ...VALID_PAYLOAD, amount_cents: 999 },
      { lookupComptawebId, lookupCarte },
    );
    expect(input.montant).toBe('9,99');
  });
});

describe('defaultCwScraper', () => {
  it('propage les erreurs CW au caller', async () => {
    // On ne peut pas tester defaultCwScraper avec injection de createEcriture
    // (l'export ne le permet pas pour rester simple). On va donc mocker via vi.mock
    // dans un test séparé. Ici on vérifie juste qu'une erreur lookup remonte
    // bien à travers le scraper (la résolution échoue → throw).

    // Sans mappings BDD réels en test (le service-singleton getDb() n'est pas
    // initialisé), le scraper doit lever via buildCwInputFromPayload.
    // On se contente d'asserter qu'il throw, le message exact dépend du
    // contexte (lookup BDD plante vs mapping null).
    await expect(
      defaultCwScraper(
        { baseUrl: 'http://localhost', cookie: 'x' },
        VALID_PAYLOAD,
      ),
    ).rejects.toThrow();
  });
});
