import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { fetchHtml } from './http';
import type {
  ComptawebConfig,
  EcritureBancaireNonRapprochee,
  EcritureComptableNonRapprochee,
  RapprochementBancaireData,
  SousLigneDsp2,
} from './types';

function parseMontantFr(text: string): number {
  const cleaned = text.replace(/\s|€/g, '').replace(',', '.');
  const n = Number(cleaned);
  if (Number.isNaN(n)) throw new Error(`Montant non reconnu : "${text}"`);
  return Math.round(n * 100);
}

function parseDateFr(text: string): string {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) throw new Error(`Date non reconnue : "${text}"`);
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function parseMontantFrFlexible(text: string): number {
  const match = text.match(/-?\d+(?:[.,]\d{1,2})?/g);
  if (!match || match.length === 0) throw new Error(`Montant non reconnu : "${text}"`);
  return parseMontantFr(match[match.length - 1]);
}

function extractIdFromName(name: string): number | null {
  const match = name.match(/\[(\d+)\]/);
  return match ? Number(match[1]) : null;
}

function parseSousLignes($: CheerioAPI, idLigne: number): SousLigneDsp2[] {
  const details = $(`#details_${idLigne}`);
  if (!details.length) return [];
  const out: SousLigneDsp2[] = [];
  details.find('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 2) return;
    const montantText = $(cells[0]).text().trim();
    const commercant = $(cells[1]).text().trim();
    if (!montantText || !commercant) return;
    try {
      out.push({ montantCentimes: parseMontantFr(montantText), commercant });
    } catch {
      // Ligne de détail mal formée, ignorée silencieusement.
    }
  });
  return out;
}

const somme = (montants: number[]) => montants.reduce((s, m) => s + m, 0);

// Au-delà, 2^n combinaisons deviennent coûteuses : on s'en tient au signe du parent.
const MAX_SOUS_LIGNES_INVERSION = 16;

/**
 * Le détail DSP2 affiche les montants des sous-lignes en VALEUR ABSOLUE
 * (« 47,94 »), le sens ne vit que sur la ligne parent (« -186,44 »). Par
 * défaut chaque sous-ligne prend donc le signe du parent — sinon toutes les
 * sous-lignes d'un paiement carte ressortent en recette.
 *
 * Mais un « PAIEMENT C. PROC » débiteur peut regrouper un REMBOURSEMENT
 * commerçant (Getaround 9,23 € dans -340,98 €). Seul le total parent le
 * trahit : la somme des sous-lignes ne retombe pas dessus. On inverse alors le
 * jeu de sous-lignes qui équilibre EXACTEMENT le parent, s'il est unique. Un
 * écart sans combinaison exacte (erreur de relevé de quelques centimes) ou
 * ambigu reste un arbitrage manuel : on garde le signe du parent.
 */
function signerSousLignes(parent: number, sousLignes: SousLigneDsp2[]): SousLigneDsp2[] {
  if (sousLignes.length === 0) return sousLignes;

  // Si CW signe lui-même le détail et que ça tombe juste, on le croit.
  const brut = sousLignes.map((sl) => sl.montantCentimes);
  if (brut.some((m) => m < 0) && somme(brut) === parent) return sousLignes;

  const sign = parent < 0 ? -1 : 1;
  const absolus = brut.map(Math.abs);
  const signes: number[] = absolus.map(() => sign);
  const ecart = sign * somme(absolus) - parent;

  if (ecart !== 0 && sousLignes.length <= MAX_SOUS_LIGNES_INVERSION) {
    // Inverser une sous-ligne déplace la somme de 2×|montant| vers le parent.
    const cible = Math.abs(ecart);
    const solutions: number[] = [];
    for (let masque = 1; masque < 1 << absolus.length; masque++) {
      let total = 0;
      for (let i = 0; i < absolus.length; i++) if (masque & (1 << i)) total += 2 * absolus[i];
      if (total === cible) solutions.push(masque);
      if (solutions.length > 1) break;
    }
    if (solutions.length === 1) {
      for (let i = 0; i < absolus.length; i++) if (solutions[0] & (1 << i)) signes[i] = -sign;
    }
  }

  return sousLignes.map((sl, i) => ({ ...sl, montantCentimes: signes[i] * absolus[i] }));
}

function parseEcritureBancaire($: CheerioAPI, tr: AnyNode): EcritureBancaireNonRapprochee | null {
  const checkbox = $(tr).find('input[name^="releve_a_rapprocher["]').first();
  if (!checkbox.length) return null;
  const id = extractIdFromName(checkbox.attr('name') ?? '');
  if (id === null) return null;

  const cells = $(tr).find('td');
  if (cells.length < 4) return null;

  const dateText = $(cells[1]).text().trim();
  const montantText = $(cells[2]).text().trim();
  const intituleClone = $(cells[3]).clone();
  intituleClone.find('table, button, a').remove();
  const intitule = intituleClone.text().replace(/\s+/g, ' ').trim();

  const montantCentimes = parseMontantFrFlexible(montantText);
  const sousLignes = signerSousLignes(montantCentimes, parseSousLignes($, id));

  return {
    id,
    dateOperation: parseDateFr(dateText),
    montantCentimes,
    intitule,
    sousLignes,
  };
}

function parseEcritureComptable($: CheerioAPI, tr: AnyNode): EcritureComptableNonRapprochee | null {
  const checkbox = $(tr).find('input[name^="ecriture_a_rapprocher["]').first();
  if (!checkbox.length) return null;
  const id = extractIdFromName(checkbox.attr('name') ?? '');
  if (id === null) return null;

  const cells = $(tr).find('td');
  if (cells.length < 9) return null;

  return {
    id,
    dateEcriture: parseDateFr($(cells[1]).text().trim()),
    type: $(cells[2]).text().trim(),
    intitule: $(cells[3]).text().trim(),
    devise: $(cells[4]).text().trim(),
    montantCentimes: parseMontantFrFlexible($(cells[5]).text().trim()),
    numeroPiece: $(cells[6]).text().trim(),
    modeTransaction: $(cells[7]).text().trim(),
    tiers: $(cells[8]).text().trim(),
  };
}

export function parseRapprochementHtml(html: string): RapprochementBancaireData {
  const $ = cheerio.load(html);

  const form = $('#form_rapprochement');
  if (!form.length) {
    throw new Error("Formulaire #form_rapprochement introuvable dans la page — structure Comptaweb a peut-être changé.");
  }

  const actionMatch = (form.attr('action') ?? '').match(/\/rapprochementbancaire\/update\/(\d+)/);
  const idCompte = actionMatch ? Number(actionMatch[1]) : 0;

  const compteSelect = $('select[name="comptebancaire"]').first();
  const libelleCompte = compteSelect.find('option:selected').text().trim() || 'inconnu';

  const innerTables = form.find('table table');
  const tableComptables = innerTables.eq(0);
  const tableBancaires = innerTables.eq(1);

  const ecrituresComptables: EcritureComptableNonRapprochee[] = [];
  tableComptables.find('tbody > tr').each((_, tr) => {
    const parsed = parseEcritureComptable($, tr);
    if (parsed) ecrituresComptables.push(parsed);
  });

  const ecrituresBancaires: EcritureBancaireNonRapprochee[] = [];
  tableBancaires.find('tbody > tr[id^="ligne_releve["]').each((_, tr) => {
    const parsed = parseEcritureBancaire($, tr);
    if (parsed) ecrituresBancaires.push(parsed);
  });

  return {
    idCompte,
    libelleCompte,
    ecrituresComptables,
    ecrituresBancaires,
  };
}

export async function listRapprochementBancaire(config: ComptawebConfig): Promise<RapprochementBancaireData> {
  const html = await fetchHtml(config, '/rapprochementbancaire?m=1');
  return parseRapprochementHtml(html);
}
