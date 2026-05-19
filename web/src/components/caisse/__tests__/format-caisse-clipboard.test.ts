// Tests du helper `formatCaisseForClipboard` — Task 9 du pivot miroir
// strict + MCP-first.
//
// Comptaweb ne supporte pas l'écriture caisse via scraping write : la
// caisse Baloo reste donc une saisie locale, mais la page assiste la
// double saisie côté CW via un bouton "Tout copier" qui formatte un
// payload prêt à coller.
//
// Le format doit être lisible humain et inclure :
//   - Date FR (jj/mm/aaaa)
//   - Type "Entrée" / "Sortie" (en clair, pas "entree"/"sortie")
//   - Montant FR avec virgule décimale et `€`
//   - Libellé
//   - Notes / unité si présentes

import { describe, it, expect } from 'vitest';
import { formatCaisseForClipboard, type CaissePayload } from '../format-caisse-clipboard';

const PAYLOAD_BASE: CaissePayload = {
  date_mouvement: '2026-05-19',
  amount_cents: 5000,
  type: 'entree',
  description: 'Quête camp été',
  unite_label: null,
  activite_label: null,
  notes: null,
};

describe('formatCaisseForClipboard', () => {
  it("formate une entrée en clair (Entrée d'espèces)", () => {
    const text = formatCaisseForClipboard(PAYLOAD_BASE);
    expect(text).toMatch(/CAISSE/);
    expect(text).toMatch(/Type\s*:\s*Entrée d'espèces/);
  });

  it('formate une sortie comme "Sortie d\'espèces"', () => {
    const text = formatCaisseForClipboard({ ...PAYLOAD_BASE, type: 'sortie' });
    expect(text).toMatch(/Type\s*:\s*Sortie d'espèces/);
  });

  it('affiche la date en format français (jj/mm/aaaa)', () => {
    const text = formatCaisseForClipboard(PAYLOAD_BASE);
    expect(text).toMatch(/Date\s*:\s*19\/05\/2026/);
  });

  it('affiche le montant avec virgule décimale et symbole €', () => {
    const text = formatCaisseForClipboard({ ...PAYLOAD_BASE, amount_cents: 5000 });
    expect(text).toMatch(/Montant\s*:\s*50,00\s*€/);
  });

  it('utilise toujours la valeur absolue du montant (pas de signe)', () => {
    // Le sens est déjà encodé dans `type`, le montant affiché est positif.
    const text = formatCaisseForClipboard({
      ...PAYLOAD_BASE,
      type: 'sortie',
      amount_cents: -2500,
    });
    expect(text).toMatch(/Montant\s*:\s*25,00\s*€/);
    expect(text).not.toMatch(/-25,00/);
  });

  it('inclut le libellé', () => {
    const text = formatCaisseForClipboard(PAYLOAD_BASE);
    expect(text).toMatch(/Libellé\s*:\s*Quête camp été/);
  });

  it("inclut l'unité si fournie", () => {
    const text = formatCaisseForClipboard({ ...PAYLOAD_BASE, unite_label: 'rouges' });
    expect(text).toMatch(/Unité\s*:\s*rouges/);
  });

  it("omet l'unité si absente", () => {
    const text = formatCaisseForClipboard(PAYLOAD_BASE);
    expect(text).not.toMatch(/Unité/);
  });

  it("inclut l'activité si fournie", () => {
    const text = formatCaisseForClipboard({
      ...PAYLOAD_BASE,
      activite_label: 'Camp été 2026',
    });
    expect(text).toMatch(/Activité\s*:\s*Camp été 2026/);
  });

  it('inclut les notes si fournies', () => {
    const text = formatCaisseForClipboard({
      ...PAYLOAD_BASE,
      notes: '5×10€ pour la cagnotte',
    });
    expect(text).toMatch(/Notes\s*:\s*5×10€/);
  });

  it('produit un bloc multi-lignes lisible', () => {
    const text = formatCaisseForClipboard(PAYLOAD_BASE);
    const lines = text.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(4);
    // Première ligne = titre / contexte.
    expect(lines[0]).toMatch(/CAISSE/i);
  });

  it('fallback gracieux quand la date est mal formée', () => {
    // Évite de cracher si quelqu'un appelle formatCaisseForClipboard
    // avec une date vide (montant pas encore saisi etc).
    const text = formatCaisseForClipboard({ ...PAYLOAD_BASE, date_mouvement: '' });
    expect(text).toMatch(/Date\s*:\s*—/);
  });
});
