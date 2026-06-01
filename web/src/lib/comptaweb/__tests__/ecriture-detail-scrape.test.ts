import { describe, it, expect } from 'vitest';
import { parseEcritureDetailHtml } from '../ecriture-detail-scrape';

// Structure réelle captée sur sgdf.production.sirom.net : tableau de
// ventilation thead colonnes / tbody une ligne par ventilation.
const HTML_MONO = `
<html><body>
  <table class="table table-striped table-hover table-bordered">
    <thead><tr>
      <th>Montant</th><th>Nature</th><th>Activité</th><th>Branche / Pôle</th>
    </tr></thead>
    <tbody><tr>
      <td>1000.00</td>
      <td>Flux financiers entre structures ( SAUF la participation aux activités)</td>
      <td>WET</td>
      <td>Groupe</td>
    </tr></tbody>
  </table>
</body></html>`;

// Multi-ventilation réel : 481 Formation/LJ + 10 Cotisations/PC = 491.
const HTML_MULTI = `
<html><body>
  <table class="table table-bordered">
    <thead><tr><th>Montant</th><th>Nature</th><th>Activité</th><th>Branche / Pôle</th></tr></thead>
    <tbody>
      <tr><td>481.00</td><td>Formation</td><td>Formation</td><td>Louveteaux-Jeannettes</td></tr>
      <tr><td>10.00</td><td>Cotisations SGDF</td><td>Fonctionnement</td><td>Pionniers-Caravelles</td></tr>
    </tbody>
  </table>
</body></html>`;

const HTML_EMPTY = `<html><body><table><tr><th>Catégorie tiers</th><td>Mon Territoire</td></tr></table></body></html>`;

describe('parseEcritureDetailHtml', () => {
  it('mono-ventilation : une ventilation avec montant + imputation', () => {
    const d = parseEcritureDetailHtml(HTML_MONO);
    expect(d.ventilations).toHaveLength(1);
    expect(d.ventilations[0]).toEqual({
      montantCents: 100000,
      nature: 'Flux financiers entre structures ( SAUF la participation aux activités)',
      activite: 'WET',
      brancheprojet: 'Groupe',
    });
  });

  it('multi-ventilation : une entrée par ligne, montants en centimes', () => {
    const d = parseEcritureDetailHtml(HTML_MULTI);
    expect(d.ventilations).toHaveLength(2);
    expect(d.ventilations[0]).toEqual({ montantCents: 48100, nature: 'Formation', activite: 'Formation', brancheprojet: 'Louveteaux-Jeannettes' });
    expect(d.ventilations[1]).toEqual({ montantCents: 1000, nature: 'Cotisations SGDF', activite: 'Fonctionnement', brancheprojet: 'Pionniers-Caravelles' });
  });

  it('renvoie ventilations vide quand pas de table de ventilation', () => {
    const d = parseEcritureDetailHtml(HTML_EMPTY);
    expect(d.ventilations).toHaveLength(0);
  });
});
