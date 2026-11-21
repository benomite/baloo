import * as cheerio from 'cheerio';
import type {
  ComptawebConfig,
  CreateEcritureInput,
  CreateEcritureResult,
  ReferentielsCreerEcriture,
  RefOption,
} from './types';
import { fetchHtml, ComptawebSessionExpiredError } from './http';
import { MODE_TRANSFERT_CW_LABELS } from '../transfert-interne';

const FORM_PATH = '/recettedepense/creer';
const POST_PATH = '/recettedepense/nouveau';

function extractOptions($: cheerio.CheerioAPI, selector: string): RefOption[] {
  return $(selector)
    .find('option')
    .toArray()
    .map((el) => ({
      value: $(el).attr('value') ?? '',
      label: $(el).text().trim(),
    }))
    .filter((o) => o.label.length > 0);
}

export async function fetchReferentielsCreer(config: ComptawebConfig): Promise<ReferentielsCreerEcriture> {
  const html = await fetchHtml(config, FORM_PATH);
  const $ = cheerio.load(html);
  const form = $('form[name="ecriturecomptable"]').first();
  const csrfToken = form.find('input[name="ecriturecomptable[_token]"]').attr('value');
  if (!csrfToken) {
    throw new Error(`CSRF token introuvable dans ${FORM_PATH} — layout a changé.`);
  }

  // Les selects de ventilation vivent dans le data-prototype du tbody Symfony.
  const tbodyProto = form.find('tbody[data-prototype]').first();
  const proto = tbodyProto.attr('data-prototype') ?? '';
  const expandedProto = proto.replace(/__name__/g, '0');
  const $proto = cheerio.load(`<table><tbody>${expandedProto}</tbody></table>`);

  return {
    csrfToken,
    depenserecette: extractOptions($, 'select[name="ecriturecomptable[depenserecette]"]'),
    devise: extractOptions($, 'select[name="ecriturecomptable[devise]"]'),
    modetransaction: extractOptions($, 'select[name="ecriturecomptable[modetransaction]"]'),
    comptebancaire: extractOptions($, 'select[name="ecriturecomptable[comptebancaire]"]'),
    chequier: extractOptions($, 'select[name="ecriturecomptable[chequier]"]'),
    cartebancaire: extractOptions($, 'select[name="ecriturecomptable[cartebancaire]"]'),
    carteprocurement: extractOptions($, 'select[name="ecriturecomptable[carteprocurement]"]'),
    caisse: extractOptions($, 'select[name="ecriturecomptable[caisse]"]'),
    tierscateg: extractOptions($, 'select[name="ecriturecomptable[tierscateg]"]'),
    tiersstructure: extractOptions($, 'select[name="ecriturecomptable[tiersstructure]"]'),
    nature: extractOptions($proto, `select[name="ecriturecomptable[ecriturecomptabledetails][0][nature]"]`),
    activite: extractOptions($proto, `select[name="ecriturecomptable[ecriturecomptabledetails][0][activite]"]`),
    brancheprojet: extractOptions($proto, `select[name="ecriturecomptable[ecriturecomptabledetails][0][brancheprojet]"]`),
  };
}

function normaliseMontant(s: string): string {
  // Comptaweb parse côté serveur avec un équivalent floatval/parseFloat : une
  // virgule tronque les décimales (16,45 → 16). On envoie donc le point.
  return s.replace(',', '.').trim();
}

function normaliseLabel(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface SelectsEcriture {
  depenserecette: string;
  modetransaction: string;
  caisse: string;
}

// Valeurs des selects d'en-tête. Dépense / recette : options fixes (1 / 2) et
// mode déjà résolu par l'appelant. Transfert interne : les options sont
// cherchées par LIBELLÉ dans le formulaire du jour (aucun id Comptaweb figé
// côté Baloo) — une option introuvable lève une erreur explicite plutôt que
// d'envoyer une valeur devinée. La caisse : celle demandée, sinon la seule
// caisse du groupe s'il n'y en a qu'une.
export function resolveSelectsEcriture(
  input: CreateEcritureInput,
  refs: Pick<ReferentielsCreerEcriture, 'depenserecette' | 'modetransaction' | 'caisse'>,
): SelectsEcriture {
  if (input.type !== 'transfert_interne') {
    return {
      depenserecette: input.type === 'depense' ? '1' : '2',
      modetransaction: input.modetransactionId,
      caisse: input.caisseId ?? '',
    };
  }
  if (!input.modeTransfert) {
    throw new Error('Transfert interne sans mode de transfert : choisis dépôt, retrait ou transfert d’espèces.');
  }
  const find = (options: RefOption[], label: string) =>
    options.find((o) => o.value !== '' && normaliseLabel(o.label) === normaliseLabel(label));
  const type = refs.depenserecette.find(
    (o) => o.value !== '' && normaliseLabel(o.label).startsWith('transfert interne'),
  );
  if (!type) throw new Error('Option « Transfert interne » introuvable dans le formulaire Comptaweb.');
  const modeLabel = MODE_TRANSFERT_CW_LABELS[input.modeTransfert];
  const mode = find(refs.modetransaction, modeLabel);
  if (!mode) throw new Error(`Mode de transaction « ${modeLabel} » introuvable dans le formulaire Comptaweb.`);
  const caisses = refs.caisse.filter((o) => o.value !== '');
  const caisse = input.caisseId ?? (caisses.length === 1 ? caisses[0].value : '');
  return { depenserecette: type.value, modetransaction: mode.value, caisse };
}

function buildPostBody(
  input: CreateEcritureInput,
  csrfToken: string,
  deviseEurId: string,
  selects: SelectsEcriture,
): URLSearchParams {
  const body = new URLSearchParams();
  body.set('ecriturecomptable[_token]', csrfToken);
  body.set('ecriturecomptable[depenserecette]', selects.depenserecette);
  body.set('ecriturecomptable[libel]', input.libel);
  body.set('ecriturecomptable[dateecriture]', input.dateecriture);
  body.set('ecriturecomptable[devise]', deviseEurId);
  body.set('ecriturecomptable[devise2]', deviseEurId);
  body.set('ecriturecomptable[montant]', normaliseMontant(input.montant));
  body.set('ecriturecomptable[montant2]', normaliseMontant(input.montant));
  body.set('ecriturecomptable[montant_ancv]', '0,00');
  body.set('ecriturecomptable[numeropiece]', input.numeropiece ?? '');
  body.set('ecriturecomptable[modetransaction]', selects.modetransaction);
  body.set('ecriturecomptable[comptebancaire]', input.comptebancaireId ?? '');
  body.set('ecriturecomptable[comptebancaire2]', '');
  body.set('ecriturecomptable[chequier]', input.chequierId ?? '');
  body.set('ecriturecomptable[chequenum]', input.chequenumValue ?? '');
  body.set('ecriturecomptable[cartebancaire]', input.cartebancaireId ?? '');
  body.set('ecriturecomptable[carteprocurement]', input.carteprocurementId ?? '');
  body.set('ecriturecomptable[caisse]', selects.caisse);
  body.set('ecriturecomptable[caisse2]', '');
  body.set('ecriturecomptable[tierscateg]', input.tiersCategId);
  body.set('ecriturecomptable[tiersstructure]', input.tiersStructureId);
  input.ventilations.forEach((v, i) => {
    const m = normaliseMontant(v.montant);
    body.set(`ecriturecomptable[ecriturecomptabledetails][${i}][montant]`, m);
    body.set(`ecriturecomptable[ecriturecomptabledetails][${i}][montantEUR]`, m);
    body.set(`ecriturecomptable[ecriturecomptabledetails][${i}][nature]`, v.natureId);
    body.set(`ecriturecomptable[ecriturecomptabledetails][${i}][activite]`, v.activiteId);
    body.set(`ecriturecomptable[ecriturecomptabledetails][${i}][brancheprojet]`, v.brancheprojetId);
  });
  body.set('territoire', '');
  body.set('ecriturecomptable[submit]', '');
  return body;
}

function validateInput(input: CreateEcritureInput): string[] {
  const warnings: string[] = [];
  if (!input.libel.trim()) warnings.push('libel vide');
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(input.dateecriture)) {
    warnings.push('dateecriture : format attendu DD/MM/YYYY');
  }
  // Un transfert interne n'a pas de ventilation (ni nature, ni activité, ni
  // branche) : il ne passe pas par le compte de résultat.
  if (input.type === 'transfert_interne') return warnings;
  if (!input.ventilations.length) warnings.push('aucune ventilation — au moins une est obligatoire');
  const totalVent = input.ventilations.reduce((acc, v) => acc + Number(v.montant.replace(',', '.')), 0);
  const total = Number(input.montant.replace(',', '.'));
  if (Math.abs(totalVent - total) > 0.005) {
    warnings.push(`somme des ventilations (${totalVent.toFixed(2)}) ≠ montant (${total.toFixed(2)})`);
  }
  return warnings;
}

export async function createEcriture(
  config: ComptawebConfig,
  input: CreateEcritureInput,
  opts: { dryRun?: boolean } = {},
): Promise<CreateEcritureResult> {
  const dryRun = opts.dryRun !== false;
  const warnings = validateInput(input);

  // Récupère toujours le CSRF (valide typiquement le temps de la session).
  const refs = await fetchReferentielsCreer(config);
  const deviseEur = refs.devise.find((o) => /^euro$/i.test(o.label));
  if (!deviseEur) throw new Error('Devise EUR introuvable dans les référentiels.');
  const body = buildPostBody(input, refs.csrfToken, deviseEur.value, resolveSelectsEcriture(input, refs));

  if (dryRun) {
    return {
      dryRun: true,
      postBody: Object.fromEntries(body.entries()),
      warnings,
    };
  }

  if (warnings.length) {
    throw new Error(`Validation échouée : ${warnings.join('; ')}. Corriger avant de relancer avec dry_run=false.`);
  }

  const postUrl = new URL(POST_PATH, config.baseUrl);
  const res = await fetch(postUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: config.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'baloo-compta/0.1',
      Accept: 'text/html',
    },
    body: body.toString(),
  });

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') ?? '';
    // Seule la redirection vers la fiche créée prouve la création. Toute autre
    // cible (retour au formulaire, liste…) = refus silencieux de CW, typiquement
    // une date hors de l'exercice ouvert (cas 2026-09-11 : 5 écritures de
    // septembre « validées » alors qu'aucune n'existait dans Comptaweb).
    const match = location.match(/\/recettedepense\/(\d+)\/afficher/);
    if (match) {
      return {
        dryRun: false,
        ecritureId: Number(match[1]),
        detailsPath: location,
        warnings,
      };
    }
    if (/\/login\b|auth\.sgdf\.fr/.test(location)) throw new ComptawebSessionExpiredError();
    throw new Error(
      `Création non confirmée par Comptaweb (redirection vers ${location || '?'}). ` +
        `Vérifie que la date ${input.dateecriture} est dans l'exercice ouvert dans Comptaweb.`,
    );
  }

  const bodyText = await res.text();
  const errDoc = cheerio.load(bodyText);
  const errors: string[] = [];
  errDoc('.alert-danger, .alert-error, .invalid-feedback, .help-block, li.error, .form-error-message').each((_, el) => {
    const t = errDoc(el).text().trim();
    if (t && !errors.includes(t)) errors.push(t);
  });
  throw new Error(
    `Création rejetée (HTTP ${res.status})${errors.length ? ` : ${errors.slice(0, 3).join(' | ')}` : ''}.`,
  );
}
