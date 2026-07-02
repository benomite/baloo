// Bug terrain 2026-07-02 : le détail DSP2 d'une ligne bancaire (« PAIEMENT
// C. PROC … ») affiche les montants des sous-lignes en VALEUR ABSOLUE
// (positifs), alors que la ligne parent est signée (-186,44 = dépense). Le
// parser doit reporter le SIGNE du parent sur chaque sous-ligne, sinon toutes
// les sous-lignes d'un paiement carte ressortent en recette (montant positif)
// → drafts créés en « recette » à tort.

import { describe, it, expect } from 'vitest';
import { parseRapprochementHtml } from '../ecritures-bancaires';

// HTML minimal reproduisant la structure attendue par parseRapprochementHtml :
// #form_rapprochement > (table comptables vide) + (table bancaires avec 1 ligne)
// et un #details_<id> portant les sous-lignes DSP2 en valeurs absolues.
function html(): string {
  return `
    <form id="form_rapprochement" action="/rapprochementbancaire/update/791">
      <select name="comptebancaire"><option selected>Compte courant</option></select>
      <table><tbody><tr><td>
        <table><tbody></tbody></table>
        <table><tbody>
          <tr id="ligne_releve[19300000]">
            <td><input type="checkbox" name="releve_a_rapprocher[19300000]" /></td>
            <td>01/06/2026</td>
            <td>-186,44</td>
            <td>
              PAIEMENT C. PROC PBWD76QHY
              <table id="details_19300000"><tbody>
                <tr><td>47,94</td><td>AUCHANSUPERMAR4727409</td></tr>
                <tr><td>96,75</td><td>INTERGREECE409503234</td></tr>
              </tbody></table>
            </td>
          </tr>
        </tbody></table>
      </td></tr></tbody></table>
    </form>`;
}

describe('parseRapprochementHtml — signe des sous-lignes DSP2', () => {
  it('reporte le signe négatif du parent (dépense) sur ses sous-lignes', () => {
    const data = parseRapprochementHtml(html());
    const ligne = data.ecrituresBancaires.find((l) => l.id === 19300000);
    expect(ligne).toBeDefined();
    expect(ligne!.montantCentimes).toBe(-18644);
    expect(ligne!.sousLignes.map((s) => s.montantCentimes)).toEqual([-4794, -9675]);
  });
});
