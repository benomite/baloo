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

// Sélection robuste : Comptaweb rend une table "wrapper" qui agrège
// les headers des sous-tables. On filtre donc par le **set exact** des
// headers attendus (et non un sous-ensemble), pour viser la vraie
// table de chaque type.
function tableHeaders($: CheerioAPI, t: AnyNode): string[] {
  return $(t)
    .find('thead th, thead td')
    .toArray()
    .map((th) => $(th).text().replace(/\s+/g, ' ').trim());
}

function findMouvementsTable($: CheerioAPI): Cheerio<AnyNode> {
  for (const t of $('table').toArray()) {
    const ths = tableHeaders($, t);
    // Vraie table mouvements : commence par '' (case action) puis
    // Date/Type/Montant/Intitulé/N° de pièce/Catégorie de tiers.
    // Exactement 7 colonnes — exclut la wrapper qui en a 14.
    if (
      ths.length === 7 &&
      ths.includes('Type de transaction') &&
      ths.includes('N° de pièce') &&
      ths.includes('Intitulé') &&
      !ths.includes('Solde')
    ) {
      return $(t);
    }
  }
  throw new Error(
    "Table mouvements caisse introuvable (en-tête 7 colonnes 'Date/Type/Montant/...' attendue) — structure Comptaweb a peut-être changé.",
  );
}

function findSoldeTable($: CheerioAPI): Cheerio<AnyNode> | null {
  for (const t of $('table').toArray()) {
    const ths = tableHeaders($, t);
    // Vraie table solde : exactement 7 colonnes Caisse/Gérant/Devise/
    // Solde début/Dépenses/Recettes/Solde.
    if (
      ths.length === 7 &&
      ths.includes('Solde début') &&
      ths.includes('Solde') &&
      ths.includes('Recettes') &&
      !ths.includes('Type de transaction')
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

  // Caisse id : Comptaweb n'expose pas un select avec selected dans
  // cette page. On extrait l'ID depuis le lien d'export (toujours
  // présent : `/caisse/export/<id>/1`) et le libellé depuis la
  // caption ("Caisse : <libellé>").
  const exportLink = $('a[href*="/caisse/export/"]')
    .toArray()
    .map((a) => $(a).attr('href') ?? '')
    .find((h) => /\/caisse\/export\/\d+/.test(h));
  const caisseId = exportLink
    ? Number(exportLink.match(/\/caisse\/export\/(\d+)/)?.[1] ?? 0)
    : 0;
  const captionText = $('caption')
    .toArray()
    .map((c) => $(c).text().replace(/\s+/g, ' ').trim())
    .find((t) => /caisse\s*:/i.test(t));
  const libelle = captionText
    ? captionText.replace(/^.*?caisse\s*:\s*/i, '').trim() || 'inconnu'
    : 'inconnu';

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

// Liste des caisses du groupe. Source : page `/caisse/gestion?m=1`
// qui rend en SSR un récap par caisse (libellé / gérant / devise /
// solde) avec, sur chaque <tr>, un `onclick="window.location.href=
// '/caisse/gestion?id=<N>'"` qui porte l'ID de la caisse.
//
// Le SSR contient bien la table (vérifié 2026-05-06 depuis Node) ;
// la page rendue navigateur ajoute juste DataTables. Un User-Agent
// "neutre" récupère exactement le même HTML.
export function parseCaisseListHtml(html: string): CaisseListItem[] {
  // Détection page de login servie en 200.
  const looksLikeLogin =
    /id=["']?kc-page-title|action=["']?[^"']*openid-connect|name=["']?password["']/i.test(
      html,
    );
  if (looksLikeLogin && !/\/caisse\/gestion\?id=\d+/.test(html)) {
    throw new ComptawebSessionExpiredError();
  }

  const $ = cheerio.load(html);
  const out: CaisseListItem[] = [];
  $('tr[onclick*="/caisse/gestion?id="]').each((_, tr) => {
    const onclick = $(tr).attr('onclick') ?? '';
    const m = onclick.match(/\/caisse\/gestion\?id=(\d+)/);
    if (!m) return;
    const id = Number(m[1]);
    if (out.some((c) => c.id === id)) return;
    const tds = $(tr).find('td').toArray();
    if (tds.length < 3) return;
    // Colonnes thead : Caisse | Gérant | Devise | Solde début | Dépenses | Recettes | Solde
    out.push({
      id,
      libelle: $(tds[0]).text().replace(/\s+/g, ' ').trim(),
      gerant: $(tds[1]).text().replace(/\s+/g, ' ').trim(),
      devise: $(tds[2]).text().replace(/\s+/g, ' ').trim(),
      // La page de gestion ne liste que les caisses actives ; pas d'info
      // d'inactivité ici. Si Comptaweb les masquait, elles ne seraient
      // pas dans la table.
      inactif: false,
    });
  });
  return out;
}

export async function fetchCaisseList(config: ComptawebConfig): Promise<CaisseListItem[]> {
  // On utilise `/caisse/gestion?m=1` (et non `/caisse`) parce que cette
  // page contient le `<select name="caissegestion">` rempli côté SSR.
  // La page `/caisse` charge sa table via AJAX → tbody vide en SSR.
  const html = await fetchHtml(config, '/caisse/gestion?m=1');
  const list = parseCaisseListHtml(html);
  if (list.length === 0) {
    // Diagnostic ciblé : capture toutes les balises <select> et <option>
    // ainsi qu'une portion du body. Le head est skippé car il pollue
    // l'échantillon sans info utile.
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
    const bodyPortion = (bodyMatch?.[0] ?? html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    const selects = Array.from(html.matchAll(/<select[^>]*>/gi)).map((m) => m[0]);
    const options = Array.from(html.matchAll(/<option[^>]*>([^<]*)<\/option>/gi))
      .map((m) => `${m[0].slice(0, 80)} → "${m[1].trim().slice(0, 60)}"`)
      .slice(0, 30);
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    throw Object.assign(
      new Error(
        `Page /caisse/gestion?m=1 ne contient aucun option de caisse. ` +
          `Title="${titleMatch?.[1]?.trim() ?? '(inconnu)'}", htmlLen=${html.length}, ` +
          `selectsCount=${selects.length}, optionsCount=${options.length}.`,
      ),
      {
        htmlSample: bodyPortion,
        selects: selects.slice(0, 10),
        options,
      },
    );
  }
  return list;
}
