import { describe, it, expect } from 'vitest';
import { genererIndexHtml, escapeHtml, hrefRelatif, type IndexHtmlData } from '../index-html';
import type { BornesExercice } from '../bornes';

const bornes: BornesExercice = {
  exercice: '2025-2026',
  debut: '2025-09-01',
  fin: '2026-08-31',
  finInclusiveTs: '2026-08-31T23:59:59Z',
};

function baseData(overrides: Partial<IndexHtmlData> = {}): IndexHtmlData {
  return {
    entete: {
      groupeNom: 'Groupe Test',
      exercice: '2025-2026',
      debut: bornes.debut,
      fin: bornes.fin,
      genereLe: '2026-09-23',
      caviardage: ["Les RIB et les tokens d'accès ont été retirés de cette archive."],
    },
    bornes,
    controles: [],
    sections: [],
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('échappe les cinq caractères sensibles au HTML', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
  it('traite null/undefined comme une chaîne vide', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('hrefRelatif', () => {
  it('préserve les séparateurs et encode chaque segment', () => {
    expect(hrefRelatif('01-ecritures/justificatifs/2026-08-05-PC25- 01 À 05')).toBe(
      '01-ecritures/justificatifs/2026-08-05-PC25-%2001%20%C3%80%2005',
    );
  });
});

describe('genererIndexHtml', () => {
  it('échappe un libellé contenant un <script> — ne casse pas la page et ne l’exécute pas', () => {
    const html = genererIndexHtml(
      baseData({
        sections: [
          {
            id: '01-ecritures',
            titre: 'Écritures',
            blocs: [
              {
                headers: [{ label: 'Description' }],
                lignes: [{ cellules: ['<script>alert(1)</script>'], dossierRelatif: null }],
              },
            ],
          },
        ],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('échappe aussi un libellé contenant des caractères dangereux dans un href de dossier', () => {
    const html = genererIndexHtml(
      baseData({
        sections: [
          {
            id: '01-ecritures',
            titre: 'Écritures',
            blocs: [
              {
                headers: [{ label: 'Description' }],
                lignes: [
                  {
                    cellules: ['Cotisation "spéciale"'],
                    dossierRelatif: '01-ecritures/justificatifs/2026-08-05-PC"><script>-cotisation',
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(html).not.toContain('"><script>');
    expect(html).toContain('Cotisation &quot;spéciale&quot;');
    // le href ne doit jamais réintroduire un guillemet brut qui romprait l'attribut
    const hrefMatch = html.match(/<a href="([^"]*)">dossier<\/a>/);
    expect(hrefMatch).not.toBeNull();
    expect(hrefMatch![1]).not.toContain('"');
    expect(hrefMatch![1]).not.toContain('<');
  });

  it('ne référence jamais de ressource externe (CDN, police, script distant)', () => {
    const html = genererIndexHtml(
      baseData({
        controles: [{ cle: 'ecriture_sans_justif', titre: 'Écritures sans justificatif', lignes: [] }],
        sections: [
          {
            id: '02-remboursements',
            titre: 'Remboursements',
            fichiers: [{ nom: 'remboursements.csv', relatif: 'remboursements.csv' }],
            blocs: [
              {
                headers: [{ label: 'Montant', align: 'right' }],
                lignes: [{ cellules: ['42,50 €'], dossierRelatif: 'REMB-2026-007-dupont' }],
              },
            ],
          },
        ],
      }),
    );
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain('cdn.');
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('n’émet que des liens relatifs — jamais de chemin absolu ni de file://', () => {
    const html = genererIndexHtml(
      baseData({
        sections: [
          {
            id: '01-ecritures',
            titre: 'Écritures',
            fichiers: [{ nom: 'ecritures.csv', relatif: 'ecritures.csv' }],
            blocs: [
              {
                headers: [{ label: 'Description' }],
                lignes: [
                  { cellules: ['Essence'], dossierRelatif: '01-ecritures/justificatifs/2026-08-05-essence' },
                ],
              },
            ],
          },
        ],
      }),
    );
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href.startsWith('/')).toBe(false);
      expect(href.startsWith('file://')).toBe(false);
      expect(href.startsWith('http')).toBe(false);
      // les ancres de sommaire (#controles) sont relatives par nature, OK
    }
  });

  it('déclare le charset utf-8', () => {
    const html = genererIndexHtml(baseData());
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('affiche un message vide plutôt qu’un tableau sans ligne', () => {
    const html = genererIndexHtml(
      baseData({
        sections: [
          {
            id: '08-comptaweb',
            titre: 'Comptaweb',
            blocs: [
              {
                headers: [{ label: 'Fichier' }],
                lignes: [],
                videTexte: 'Aucun export Comptaweb rattaché à cet exercice.',
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('Aucun export Comptaweb rattaché à cet exercice.');
    expect(html).not.toContain('<table>');
  });

  it('omet la colonne Pièces pour un bloc qui n’a pas de notion de dossier', () => {
    const html = genererIndexHtml(
      baseData({
        sections: [
          {
            id: '06-referentiels',
            titre: 'Référentiels',
            blocs: [
              {
                headers: [{ label: 'Nom' }, { label: 'Lignes', align: 'right' }],
                lignes: [{ cellules: ['unites', '4'] }],
              },
            ],
          },
        ],
      }),
    );
    expect(html).not.toContain('<th>Pièces</th>');
  });

  it('rend plusieurs blocs sous une même section (ex. 04-caisse)', () => {
    const html = genererIndexHtml(
      baseData({
        sections: [
          {
            id: '04-caisse',
            titre: 'Caisse',
            blocs: [
              {
                titre: 'Mouvements',
                headers: [{ label: 'Description' }],
                lignes: [{ cellules: ['Achat matériel'] }],
              },
              {
                titre: 'Dépôts espèces',
                headers: [{ label: 'Montant', align: 'right' }],
                lignes: [{ cellules: ['100,00 €'] }],
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain('Mouvements');
    expect(html).toContain('Dépôts espèces');
    expect(html).toContain('Achat matériel');
    expect(html).toContain('100,00 €');
  });
});
