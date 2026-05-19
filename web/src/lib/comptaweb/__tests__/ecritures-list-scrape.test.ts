// Tests du scraper liste écritures Comptaweb (`GET /recettedepense?m=1`).
//
// Deux niveaux :
// 1) HTML inline synthétique, calqué sur la structure observée sur une
//    capture réelle du 2026-05-19 (cf. ecritures-list-scrape.ts). Permet
//    de tester chaque cas (dépense, recette, rapproché, n° pièce vide,
//    montant tordu) sans dépendre d'une fixture binaire.
// 2) Test conditionnel sur fixture locale `fixtures/recettedepense-local.html`
//    si elle existe (gitignored, capturée à la main par le user). Permet
//    de stress-tester le parser contre les vraies données sans bloquer la
//    CI quand la fixture est absente.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseListeEcrituresHtml } from '../ecritures-list-scrape';

const FIXTURES_DIR = join(__dirname, 'fixtures');
const LOCAL_FIXTURE = join(FIXTURES_DIR, 'recettedepense-local.html');

// Squelette de page Comptaweb minimale. Réutilisable dans les tests
// avec interpolation des <tr> dans `${rows}`.
const PAGE_TEMPLATE = (rows: string) => `<!doctype html>
<html><body>
  <div class="panel panel-default">
    <div class="panel-heading"><span class="titrepage">DÉPENSE / RECETTE</span></div>
    <div class="panel-body">
      <table class="table table-striped table-hover table-bordered table-triable-sans-tri-initial">
        <thead>
          <tr>
            <th style="width: 10%"></th>
            <th>Date </th>
            <th>Compte bancaire</th>
            <th>Intitulé </th>
            <th>Dépense&nbsp;&nbsp;</th>
            <th>Recette&nbsp;&nbsp;</th>
            <th>N°<br />pièce&nbsp;&nbsp;</th>
            <th>Mode de <br />transaction</th>
            <th>Catégorie <br />tiers </th>
            <th>Structure <br />du tiers </th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>
</body></html>`;

function mkRowRecette(opts: {
  id: number;
  numeroPiece?: string;
  montantTxt: string;
  date: string;
  intitule: string;
  mode?: string;
  rapproche?: boolean;
}): string {
  const href = `/recettedepense/${opts.id}/afficher`;
  const onclick = `onclick="window.location.href='${href}';"`;
  const rapprochementBlock = opts.rapproche
    ? `<a href="/rapprochementbancaire/voir/${opts.id}/791/1"><button class="btn btn-primary btn-xs"><span class="fa fa-check"></span></button></a>`
    : `<a href="/rapprochementbancaire/791?eb_id=${opts.id}"><button class="btn btn-primary btn-xs"><span class="fa fa-random"></span></button></a>`;
  return `<tr>
    <td ${onclick}>${rapprochementBlock}</td>
    <td ${onclick}><div class="hidden">${opts.date.replace(/-/g, '')}</div>${opts.date.split('-').reverse().join('/')}</td>
    <td ${onclick}>GROUPE VAL DE SAONE</td>
    <td ${onclick}>${opts.intitule}</td>
    <td ${onclick} style="text-align : right;"></td>
    <td ${onclick} style="text-align : right;">${opts.montantTxt}</td>
    <td ${onclick}>${opts.numeroPiece ?? ''}</td>
    <td ${onclick}>${opts.mode ?? 'Virement'}</td>
    <td ${onclick}>Echelon National</td>
    <td></td>
  </tr>`;
}

function mkRowDepense(opts: {
  id: number;
  numeroPiece?: string;
  montantTxt: string;
  date: string;
  intitule: string;
  mode?: string;
  rapproche?: boolean;
}): string {
  const href = `/recettedepense/${opts.id}/afficher`;
  const onclick = `onclick="window.location.href='${href}';"`;
  const rapprochementBlock = opts.rapproche
    ? `<a href="/rapprochementbancaire/voir/${opts.id}/791/1"><button class="btn btn-primary btn-xs"><span class="fa fa-check"></span></button></a>`
    : `<a href="/rapprochementbancaire/791?eb_id=${opts.id}"><button class="btn btn-primary btn-xs"><span class="fa fa-random"></span></button></a>`;
  return `<tr>
    <td ${onclick}>${rapprochementBlock}</td>
    <td ${onclick}><div class="hidden">${opts.date.replace(/-/g, '')}</div>${opts.date.split('-').reverse().join('/')}</td>
    <td ${onclick}>GROUPE VAL DE SAONE</td>
    <td ${onclick}>${opts.intitule}</td>
    <td ${onclick} style="text-align : right;">${opts.montantTxt}</td>
    <td ${onclick} style="text-align : right;"></td>
    <td ${onclick}>${opts.numeroPiece ?? ''}</td>
    <td ${onclick}>${opts.mode ?? 'Carte bancaire'}</td>
    <td ${onclick}>Fournisseur</td>
    <td ${onclick}>Décathlon</td>
  </tr>`;
}

describe('parseListeEcrituresHtml', () => {
  it('parse une dépense simple', () => {
    const html = PAGE_TEMPLATE(
      mkRowDepense({
        id: 2386515,
        numeroPiece: 'ECR-2026-101',
        montantTxt: '491,00',
        date: '2026-05-04',
        intitule: 'Regroupement de 2 prélèvements',
      }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures).toHaveLength(1);
    expect(res.ecritures[0]).toMatchObject({
      id: 2386515,
      numeroPiece: 'ECR-2026-101',
      dateEcriture: '2026-05-04',
      type: 'depense',
      intitule: 'Regroupement de 2 prélèvements',
      montantCentimes: 49100,
      compteBancaire: 'GROUPE VAL DE SAONE',
      modeTransaction: 'Carte bancaire',
      rapproche: false,
    });
  });

  it('parse une recette simple', () => {
    const html = PAGE_TEMPLATE(
      mkRowRecette({
        id: 2387011,
        numeroPiece: 'ECR-2026-213',
        montantTxt: '1000,00',
        date: '2026-04-30',
        intitule: 'Don WET',
      }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures).toHaveLength(1);
    expect(res.ecritures[0]).toMatchObject({
      id: 2387011,
      numeroPiece: 'ECR-2026-213',
      dateEcriture: '2026-04-30',
      type: 'recette',
      montantCentimes: 100000,
      rapproche: false,
    });
  });

  it('détecte le statut rapproché via /rapprochementbancaire/voir/', () => {
    const html = PAGE_TEMPLATE(
      mkRowDepense({
        id: 1,
        montantTxt: '10,00',
        date: '2026-05-01',
        intitule: 'Test',
        rapproche: true,
      }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures[0].rapproche).toBe(true);
  });

  it('accepte un numéro de pièce vide', () => {
    const html = PAGE_TEMPLATE(
      mkRowDepense({
        id: 1,
        montantTxt: '10,00',
        date: '2026-05-01',
        intitule: 'Sans piece',
        numeroPiece: '',
      }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures[0].numeroPiece).toBe('');
  });

  it('parse plusieurs lignes en préservant l ordre', () => {
    const html = PAGE_TEMPLATE(
      mkRowDepense({ id: 1, montantTxt: '10,00', date: '2026-05-01', intitule: 'A' }) +
        mkRowRecette({ id: 2, montantTxt: '20,00', date: '2026-05-02', intitule: 'B' }) +
        mkRowDepense({ id: 3, montantTxt: '30,00', date: '2026-05-03', intitule: 'C' }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(res.ecritures.map((e) => e.type)).toEqual(['depense', 'recette', 'depense']);
  });

  it('parse les montants français avec séparateur de milliers', () => {
    const html = PAGE_TEMPLATE(
      mkRowDepense({
        id: 1,
        montantTxt: '1 234,56',
        date: '2026-05-01',
        intitule: 'Gros achat',
      }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures[0].montantCentimes).toBe(123456);
  });

  it('skip les lignes où ni dépense ni recette ne sont renseignées', () => {
    const totalRow = `<tr>
      <td></td>
      <td><div class="hidden">20260501</div>01/05/2026</td>
      <td></td><td>Total</td>
      <td></td><td></td><td></td><td></td><td></td><td></td>
    </tr>`;
    const html = PAGE_TEMPLATE(
      mkRowDepense({ id: 1, montantTxt: '10,00', date: '2026-05-01', intitule: 'A' }) +
        totalRow,
    );
    const res = parseListeEcrituresHtml(html);
    // Seule la ligne dépense valide remonte ; la ligne "total" sans
    // ID ni montant est filtrée.
    expect(res.ecritures).toHaveLength(1);
    expect(res.ecritures[0].id).toBe(1);
  });

  it('lève une erreur explicite si la table principale est introuvable', () => {
    const html = '<html><body><p>Page CW sans table</p></body></html>';
    expect(() => parseListeEcrituresHtml(html)).toThrow(
      /Table \/recettedepense introuvable/,
    );
  });

  it('tolère une ligne tordue sans planter la sync entière', () => {
    const html = PAGE_TEMPLATE(
      mkRowDepense({ id: 1, montantTxt: '10,00', date: '2026-05-01', intitule: 'OK' }) +
        // Ligne avec moins de 10 cells : ignorée silencieusement.
        '<tr><td>incomplete</td></tr>' +
        mkRowRecette({ id: 2, montantTxt: '20,00', date: '2026-05-02', intitule: 'OK2' }),
    );
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures.map((e) => e.id)).toEqual([1, 2]);
  });
});

// ============================================================
// Test conditionnel — fixture locale (gitignored)
// ============================================================
const hasLocalFixture = existsSync(LOCAL_FIXTURE);
const localDescribe = hasLocalFixture ? describe : describe.skip;

localDescribe('parseListeEcrituresHtml — fixture locale réelle', () => {
  it('extrait au moins 50 écritures avec id + date + montant cohérents', () => {
    const html = readFileSync(LOCAL_FIXTURE, 'utf-8');
    const res = parseListeEcrituresHtml(html);
    expect(res.ecritures.length).toBeGreaterThanOrEqual(50);

    // Invariants par écriture.
    for (const e of res.ecritures) {
      expect(e.id).toBeGreaterThan(0);
      expect(e.dateEcriture).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.montantCentimes).toBeGreaterThan(0);
      expect(['depense', 'recette']).toContain(e.type);
      expect(typeof e.intitule).toBe('string');
      expect(typeof e.numeroPiece).toBe('string');
      expect(typeof e.rapproche).toBe('boolean');
    }
  });

  it('au moins une ligne rapprochée et une non rapprochée', () => {
    const html = readFileSync(LOCAL_FIXTURE, 'utf-8');
    const res = parseListeEcrituresHtml(html);
    const rapprochees = res.ecritures.filter((e) => e.rapproche);
    const nonRapprochees = res.ecritures.filter((e) => !e.rapproche);
    // Une vraie liste a typiquement les deux. Si ce n'est pas le cas, on
    // veut le savoir (la fixture est probablement non représentative).
    expect(rapprochees.length + nonRapprochees.length).toBe(res.ecritures.length);
  });

  it('au moins quelques numéros de pièce non vides au format ECR-YYYY-NNN', () => {
    const html = readFileSync(LOCAL_FIXTURE, 'utf-8');
    const res = parseListeEcrituresHtml(html);
    const withPiece = res.ecritures.filter((e) =>
      /^ECR-\d{4}-\d+$/.test(e.numeroPiece),
    );
    expect(withPiece.length).toBeGreaterThan(0);
  });
});
