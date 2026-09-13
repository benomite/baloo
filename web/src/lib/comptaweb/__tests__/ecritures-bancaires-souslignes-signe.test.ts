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
function html(
  parent = '-186,44',
  sousLignes: Array<[string, string]> = [
    ['47,94', 'AUCHANSUPERMAR4727409'],
    ['96,75', 'INTERGREECE409503234'],
    ['41,75', 'DECATHLON'],
  ],
): string {
  const details = sousLignes.map(([m, c]) => `<tr><td>${m}</td><td>${c}</td></tr>`).join('');
  return `
    <form id="form_rapprochement" action="/rapprochementbancaire/update/791">
      <select name="comptebancaire"><option selected>Compte courant</option></select>
      <table><tbody><tr><td>
        <table><tbody></tbody></table>
        <table><tbody>
          <tr id="ligne_releve[19300000]">
            <td><input type="checkbox" name="releve_a_rapprocher[19300000]" /></td>
            <td>01/06/2026</td>
            <td>${parent}</td>
            <td>
              PAIEMENT C. PROC PBWD76QHY
              <table id="details_19300000"><tbody>${details}</tbody></table>
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
    expect(ligne!.sousLignes.map((s) => s.montantCentimes)).toEqual([-4794, -9675, -4175]);
  });

  // Bug terrain 2026-09-13 : un remboursement commerçant (Getaround 9,23 €)
  // regroupé dans un « PAIEMENT C. PROC » débiteur. Le détail ne porte pas de
  // signe, seul le total parent le trahit : -340,98 ≠ -359,44.
  const ligneGetaround: Array<[string, string]> = [
    ['93,41', 'DACAUCHANCARBU'],
    ['9,23', 'GETAROUND*RESERVATION'],
    ['24,74', 'TOVIDIS'],
    ['21,78', 'SUPERU9239421'],
    ['210,28', 'SUPERU9239420'],
  ];

  function sousMontants(parent: string, sl: Array<[string, string]>): number[] {
    const data = parseRapprochementHtml(html(parent, sl));
    return data.ecrituresBancaires[0].sousLignes.map((s) => s.montantCentimes);
  }

  it('inverse la sous-ligne créditrice que le total parent révèle', () => {
    expect(sousMontants('-340,98', ligneGetaround)).toEqual([-9341, 923, -2474, -2178, -21028]);
  });

  it('respecte un signe explicite porté par le détail quand il équilibre le parent', () => {
    const sl: Array<[string, string]> = [['-93,41', 'A'], ['+9,23', 'B']];
    expect(sousMontants('-84,18', sl)).toEqual([-9341, 923]);
  });

  it("n'inverse rien sur un simple écart de relevé (somme ≠ parent sans combinaison exacte)", () => {
    const sl: Array<[string, string]> = [['217,10', 'LECLERC'], ['10,00', 'X']];
    expect(sousMontants('-227,12', sl)).toEqual([-21710, -1000]);
  });

  it("n'inverse rien quand plusieurs combinaisons équilibrent (ambigu)", () => {
    // -10 = -20 +10 : on peut inverser la 2ᵉ OU la 3ᵉ sous-ligne.
    const sl: Array<[string, string]> = [['20,00', 'A'], ['5,00', 'B'], ['5,00', 'C']];
    expect(sousMontants('-20,00', sl)).toEqual([-2000, -500, -500]);
  });
});
