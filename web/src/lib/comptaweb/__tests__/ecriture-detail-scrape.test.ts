import { describe, it, expect } from 'vitest';
import { parseEcritureDetailHtml } from '../ecriture-detail-scrape';

// Structure réelle captée sur sgdf.production.sirom.net (écriture 2390826,
// 2026-06-01) : tableau de ventilation thead colonnes / tbody valeurs.
const HTML_REAL = `
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

// Plusieurs ventilations : on prend la première ligne.
const HTML_MULTI = `
<html><body>
  <table class="table table-bordered">
    <thead><tr><th>Montant</th><th>Nature</th><th>Activité</th><th>Branche / Pôle</th></tr></thead>
    <tbody>
      <tr><td>600,00</td><td>Cotisations</td><td>Camp été</td><td>Louveteaux</td></tr>
      <tr><td>400,00</td><td>Dons</td><td>Week-end</td><td>Pionniers</td></tr>
    </tbody>
  </table>
</body></html>`;

// Pas de table de ventilation.
const HTML_EMPTY = `<html><body><table><tr><th>Catégorie tiers</th><td>Mon Territoire</td></tr></table></body></html>`;

describe('parseEcritureDetailHtml', () => {
  it('extrait nature / activité / branche depuis le tableau de ventilation réel', () => {
    const d = parseEcritureDetailHtml(HTML_REAL);
    expect(d.nature).toBe('Flux financiers entre structures ( SAUF la participation aux activités)');
    expect(d.activite).toBe('WET');
    expect(d.brancheprojet).toBe('Groupe');
  });

  it('prend la première ligne de ventilation en cas de multi-ventilation', () => {
    const d = parseEcritureDetailHtml(HTML_MULTI);
    expect(d.nature).toBe('Cotisations');
    expect(d.activite).toBe('Camp été');
    expect(d.brancheprojet).toBe('Louveteaux');
  });

  it('renvoie null quand il n’y a pas de table de ventilation', () => {
    const d = parseEcritureDetailHtml(HTML_EMPTY);
    expect(d.activite).toBeNull();
    expect(d.brancheprojet).toBeNull();
    expect(d.nature).toBeNull();
  });
});
