import { describe, it, expect } from 'vitest';
import { parseEcritureDetailHtml } from '../ecriture-detail-scrape';

// Layout 1 : definition list (dl/dt/dd).
const HTML_DL = `
<html><body>
  <dl class="dl-horizontal">
    <dt>Intitulé</dt><dd>Don WET</dd>
    <dt>Activité</dt><dd>Camp été 2026</dd>
    <dt>Branche / projet</dt><dd>Louveteaux-Jeannettes</dd>
  </dl>
</body></html>`;

// Layout 2 : tableau th/td.
const HTML_TABLE = `
<html><body>
  <table><tbody>
    <tr><th>Date</th><td>04/05/2026</td></tr>
    <tr><th>Activité</th><td>Week-end Pionniers</td></tr>
    <tr><th>Projet</th><td>Pionniers-Caravelles</td></tr>
  </tbody></table>
</body></html>`;

// Layout 3 : champs absents.
const HTML_EMPTY = `<html><body><p>Rien d'utile ici</p></body></html>`;

describe('parseEcritureDetailHtml', () => {
  it('extrait activité + branche depuis un dl', () => {
    const d = parseEcritureDetailHtml(HTML_DL);
    expect(d.activite).toBe('Camp été 2026');
    expect(d.brancheprojet).toBe('Louveteaux-Jeannettes');
  });

  it('extrait activité + branche depuis un tableau th/td', () => {
    const d = parseEcritureDetailHtml(HTML_TABLE);
    expect(d.activite).toBe('Week-end Pionniers');
    expect(d.brancheprojet).toBe('Pionniers-Caravelles');
  });

  it('renvoie null quand les champs sont absents', () => {
    const d = parseEcritureDetailHtml(HTML_EMPTY);
    expect(d.activite).toBeNull();
    expect(d.brancheprojet).toBeNull();
  });
});
