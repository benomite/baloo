import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchHtml, ComptawebSessionExpiredError } from './http';
import type { ComptawebConfig } from './types';

// Une ligne de la vue caisse Comptaweb (`/caisse/gestion?id=<caisseId>`).
// Chaque ligne pointe vers une écriture comptable identifiée par
// `recettedepense/{id}` ; cet id sert de clé d'idempotence pour la sync.
export interface MouvementCaisseComptaweb {
  comptawebEcritureId: number;
  date: string;
  type: 'recette' | 'depense' | 'transfert';
  montantCentimes: number;
  intitule: string;
  numeroPiece: string | null;
  categorieTiers: string | null;
}

export interface CaisseGestionData {
  caisseId: number;
  libelle: string;
  soldeDebutCentimes: number;
  depensesCentimes: number;
  recettesCentimes: number;
  soldeCentimes: number;
  mouvements: MouvementCaisseComptaweb[];
}

export interface CaisseListItem {
  id: number;
  libelle: string;
  gerant: string;
  devise: string;
  inactif: boolean;
}

function parseMontantFr(text: string): number {
  const cleaned = text.replace(/\s|€/g, '').replace(',', '.');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (Number.isNaN(n)) throw new Error(`Montant non reconnu : "${text}"`);
  return Math.round(n * 100);
}

// Comptaweb préfixe certaines dates par YYYYMMDD pour tri DataTables.
// On extrait toujours la forme JJ/MM/AAAA pour parser proprement.
function parseDateFr(text: string): string {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) throw new Error(`Date non reconnue : "${text}"`);
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function mapType(text: string): 'recette' | 'depense' | 'transfert' {
  const t = text.toLowerCase();
  if (t.startsWith('recette')) return 'recette';
  if (t.startsWith('dépense') || t.startsWith('depense')) return 'depense';
  if (t.includes('transfert')) return 'transfert';
  throw new Error(`Type de mouvement caisse inconnu : "${text}"`);
}

function findMouvementsTable($: CheerioAPI): Cheerio<AnyNode> {
  // La table mouvements porte un thead avec ces colonnes typiques.
  // On choisit la première table qui matche pour être robuste à
  // d'autres tables présentes (ex. tableau récap solde au-dessus).
  const tables = $('table');
  for (const t of tables.toArray()) {
    const ths = $(t)
      .find('thead th, thead td')
      .toArray()
      .map((th) => $(th).text().trim());
    if (
      ths.includes('Type de transaction') &&
      ths.includes('N° de pièce') &&
      ths.includes('Intitulé')
    ) {
      return $(t);
    }
  }
  throw new Error(
    "Table mouvements caisse introuvable (en-tête 'Type de transaction'/'N° de pièce'/'Intitulé' attendue) — structure Comptaweb a peut-être changé.",
  );
}

function findSoldeTable($: CheerioAPI): Cheerio<AnyNode> | null {
  const tables = $('table');
  for (const t of tables.toArray()) {
    const ths = $(t)
      .find('thead th, thead td')
      .toArray()
      .map((th) => $(th).text().trim());
    if (
      ths.includes('Solde début') &&
      ths.includes('Solde') &&
      ths.includes('Recettes')
    ) {
      return $(t);
    }
  }
  return null;
}

export function parseCaisseGestionHtml(html: string): CaisseGestionData {
  const $ = cheerio.load(html);

  // Détection d'une page de login servie en HTTP 200 (le re-login
  // Keycloak renvoie parfois un formulaire au lieu d'une redirection).
  // Sans ce check, le parser plante plus tard sur "table introuvable"
  // et `withAutoReLogin` ne re-tente pas.
  const looksLikeLogin =
    /id=["']?kc-page-title|action=["']?[^"']*openid-connect|name=["']?password["']/i.test(
      html,
    );
  if (looksLikeLogin && !html.includes('caissegestion')) {
    throw new ComptawebSessionExpiredError();
  }

  // Caisse id : extrait de /caisse/gestion?id=<id> via une option du
  // select<select name="caissegestion">. Plus stable que de retomber
  // sur l'URL (parfois on est dans un POST).
  const selected = $('select[name="caissegestion"] option[selected]').first();
  const caisseId = Number(selected.attr('value') ?? '0');
  const libelle = selected.text().trim() || 'inconnu';

  let soldeDebutCentimes = 0;
  let depensesCentimes = 0;
  let recettesCentimes = 0;
  let soldeCentimes = 0;
  const soldeTable = findSoldeTable($);
  if (soldeTable) {
    const cells = soldeTable.find('tbody tr').first().find('td').toArray();
    if (cells.length >= 7) {
      soldeDebutCentimes = parseMontantFr($(cells[3]).text().trim());
      depensesCentimes = parseMontantFr($(cells[4]).text().trim());
      recettesCentimes = parseMontantFr($(cells[5]).text().trim());
      soldeCentimes = parseMontantFr($(cells[6]).text().trim());
    }
  }

  const table = findMouvementsTable($);
  const mouvements: MouvementCaisseComptaweb[] = [];

  table.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td').toArray();
    if (tds.length < 6) return;

    // Repérer l'id de l'écriture via le lien d'action en première
    // colonne (`/recettedepense/{id}/...`). Filtre aussi les éventuelles
    // lignes d'entête/total qui n'ont pas ce lien.
    const link = $(tds[0]).find('a').attr('href') ?? '';
    const m = link.match(/recettedepense\/(\d+)/);
    if (!m) return;
    const comptawebEcritureId = Number(m[1]);

    const dateText = $(tds[1]).text().trim();
    const typeText = $(tds[2]).text().trim();
    const montantText = $(tds[3]).text().trim();
    const intitule = $(tds[4]).text().replace(/\s+/g, ' ').trim();
    const numeroPiece = $(tds[5]).text().trim() || null;
    const categorieTiers = tds.length > 6 ? $(tds[6]).text().trim() || null : null;

    try {
      mouvements.push({
        comptawebEcritureId,
        date: parseDateFr(dateText),
        type: mapType(typeText),
        montantCentimes: parseMontantFr(montantText),
        intitule,
        numeroPiece,
        categorieTiers,
      });
    } catch (err) {
      // Ligne mal formée : on log et on continue, plutôt que de
      // planter toute la sync sur 1 anomalie ponctuelle Comptaweb.
      console.warn(
        `[caisse-scrape] Ligne ignorée (cw=${comptawebEcritureId}) : ${err instanceof Error ? err.message : err}`,
      );
    }
  });

  return {
    caisseId,
    libelle,
    soldeDebutCentimes,
    depensesCentimes,
    recettesCentimes,
    soldeCentimes,
    mouvements,
  };
}

export async function fetchCaisseGestion(
  config: ComptawebConfig,
  caisseId: number,
): Promise<CaisseGestionData> {
  const html = await fetchHtml(config, `/caisse/gestion?id=${caisseId}`);
  return parseCaisseGestionHtml(html);
}

// Liste des caisses du groupe (page `/caisse`). Sert à découvrir
// l'identifiant de la caisse principale au premier sync.
export function parseCaisseListHtml(html: string): CaisseListItem[] {
  // Comme parseCaisseGestionHtml : si Comptaweb sert le formulaire de
  // login en HTTP 200 (cookie expiré sans redirect), on doit le
  // détecter pour que withAutoReLogin re-tente. Sinon le parser
  // retourne juste [] et on conclut "aucune caisse active" à tort.
  const looksLikeLogin =
    /id=["']?kc-page-title|action=["']?[^"']*openid-connect|name=["']?password["']/i.test(
      html,
    );
  if (looksLikeLogin && !/\/caisse\/\d+\/(show|edit)/.test(html)) {
    throw new ComptawebSessionExpiredError();
  }

  const $ = cheerio.load(html);
  const out: CaisseListItem[] = [];
  // Les liens "/caisse/{id}/show" / "/caisse/{id}/edit" pointent vers
  // chaque caisse. On déduit la liste depuis ces liens et on récupère
  // le libellé via la première cellule de la ligne.
  $('a[href^="/caisse/"]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const m = href.match(/^\/caisse\/(\d+)\//);
    if (!m) return;
    const id = Number(m[1]);
    if (out.some((c) => c.id === id)) return;
    const tr = $(a).closest('tr');
    const cells = tr.find('td').toArray();
    if (cells.length < 3) return;
    // Colonnes thead : Libellé | Devise | Utilisateur qui la gère | Inactive
    out.push({
      id,
      libelle: $(cells[0]).text().trim(),
      devise: $(cells[1]).text().trim(),
      gerant: $(cells[2]).text().trim(),
      inactif: ($(cells[3]).text().trim() || '').toLowerCase().includes('inactive'),
    });
  });
  return out;
}

export async function fetchCaisseList(config: ComptawebConfig): Promise<CaisseListItem[]> {
  const html = await fetchHtml(config, '/caisse');
  const list = parseCaisseListHtml(html);
  if (list.length === 0) {
    // Erreur "0 caisse" : on attache un échantillon du HTML pour
    // comprendre côté `/admin/errors` (page de login non détectée ?
    // structure inattendue ?). Évite de redéployer juste pour debug.
    const sample = html.replace(/\s+/g, ' ').slice(0, 1500);
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    throw Object.assign(
      new Error(
        `Page /caisse retournée par Comptaweb ne contient aucune caisse parseable. ` +
          `Title="${titleMatch?.[1]?.trim() ?? '(inconnu)'}", htmlLen=${html.length}.`,
      ),
      { htmlSample: sample },
    );
  }
  return list;
}
