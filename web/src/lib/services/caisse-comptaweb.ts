// Cycle de vie d'un mouvement de caisse avec Comptaweb (#61).
//
// Comptaweb est la source de vérité de la caisse, comme de la banque. Même
// modèle que les écritures bancaires :
//
//   draft ──(envoi CW)──▶ pending_sync ──(sync_run)──▶ miroir
//
// - Un brouillon (`draft`) est validé comme un brouillon bancaire : le payload
//   passe par l'adaptateur de la banque (`buildCwInputFromPayload`), qui exige
//   mode, nature, activité, unité et leurs correspondances Comptaweb pour
//   l'exercice de la date.
// - L'envoi crée l'écriture dans la caisse Comptaweb, retient son id et son
//   n° de pièce, et passe le mouvement en `pending_sync`. Le sync caisse
//   (`persistCaisseSync`, joué par sync_run) le retrouve par cet id — ou à
//   défaut par n° de pièce + date + montant — et le met à jour au lieu
//   d'insérer une seconde ligne : aucun doublon.
// - Les mouvements Baloo-only hérités (ni brouillon, ni miroir) se listent,
//   puis s'envoient à Comptaweb ou se rapprochent d'une ligne de caisse CW
//   choisie par l'utilisateur. Aucun n'est supprimé (règle « jamais de
//   DELETE ») : un mouvement doublonné par la ligne CW déjà importée est
//   archivé (`archived_at`), comme le fait `archiveOrphanedCaisseRows`.
//
// Les dépôts et retraits d'espèces (#51) sont des transferts internes : ils
// partent dans Comptaweb par leur brouillon bancaire, pas d'ici.

import { getDb } from '../db';
import { currentTimestamp } from '../ids';
import { uniteScopeSql } from '../scope';
import { createEcriture } from '../comptaweb/ecritures-write';
import { withComptaweb } from '../comptaweb/auth';
import type { ComptawebConfig, CreateEcritureInput } from '../comptaweb/types';
import type { MouvementCaisse } from '../types';
import { buildCwInputFromPayload, type ResolveDeps } from './ecritures-create-cw-adapter';
import type { EcriturePayload } from './ecritures-create';
import { resoudreExercicePourDate } from './exercice-pour-ecriture';
import { resolveCaisseId } from './caisse-sync';
import type { CaisseContext } from './caisse';

type MouvementRow = MouvementCaisse & { archived_at: string | null; group_id: string };

async function requireMouvement(groupId: string, mouvementId: string): Promise<MouvementRow> {
  const row = await getDb()
    .prepare('SELECT * FROM mouvements_caisse WHERE id = ? AND group_id = ?')
    .get<MouvementRow>(mouvementId, groupId);
  if (!row) throw new Error(`Mouvement de caisse ${mouvementId} introuvable.`);
  return row;
}

// ─── Liste des mouvements Baloo-only ──────────────────────────────────────

export async function listMouvementsCaisseBalooOnly({
  groupId,
  scopeUniteIds,
}: CaisseContext): Promise<MouvementCaisse[]> {
  const scope = uniteScopeSql(scopeUniteIds ?? [], 'unite_id');
  return await getDb()
    .prepare(
      `SELECT * FROM mouvements_caisse
        WHERE group_id = ?
          AND comptaweb_ecriture_id IS NULL
          AND archived_at IS NULL
          AND status NOT IN ('draft', 'pending_sync')
          ${scope.sql ? `AND ${scope.sql}` : ''}
        ORDER BY date_mouvement DESC, created_at DESC`,
    )
    .all<MouvementCaisse>(groupId, ...scope.params);
}

// ─── Envoi à Comptaweb ────────────────────────────────────────────────────

export interface PushMouvementCaisseDeps extends ResolveDeps {
  /** Override pour tests : exercice Comptaweb de la date du mouvement. */
  resoudreExercice?: (groupId: string, dateIso: string) => Promise<{ cwId: number }>;
  /** Override pour tests : session Comptaweb de l'exercice. */
  withSession?: <T>(cwId: number, fn: (cfg: ComptawebConfig) => Promise<T>) => Promise<T>;
  /** Override pour tests : caisse Comptaweb cible. */
  resolveCaisseId?: (cfg: ComptawebConfig) => Promise<number>;
}

export interface PushMouvementCaisseResult {
  ok: boolean;
  dryRun: boolean;
  message: string;
  comptawebEcritureId?: number;
}

function normaliseNom(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

// Mode de paiement « Espèces » des référentiels (synchronisés depuis
// Comptaweb) : c'est lui qui fait d'une écriture une ligne de caisse.
async function modeEspecesId(): Promise<string | null> {
  const modes = await getDb()
    .prepare('SELECT id, name FROM modes_paiement')
    .all<{ id: string; name: string }>();
  return modes.find((m) => normaliseNom(m.name) === 'especes')?.id ?? null;
}

function blocages(m: MouvementRow): string[] {
  const raisons: string[] = [];
  if (m.archived_at) raisons.push('mouvement archivé');
  if (m.comptaweb_ecriture_id !== null) {
    raisons.push(`déjà dans Comptaweb (id ${m.comptaweb_ecriture_id})`);
  }
  if (m.status === 'pending_sync') raisons.push('déjà envoyé, en attente du prochain sync_run');
  if (m.type === 'depot' || m.type === 'retrait') {
    raisons.push(
      "dépôt/retrait d'espèces : il part dans Comptaweb avec son brouillon bancaire (transfert interne)",
    );
  }
  if (m.amount_cents === 0) raisons.push('montant nul');
  return raisons;
}

export async function pushMouvementCaisseToComptaweb(
  { groupId }: CaisseContext,
  mouvementId: string,
  opts: { dryRun?: boolean; deps?: PushMouvementCaisseDeps } = {},
): Promise<PushMouvementCaisseResult> {
  const dryRun = opts.dryRun !== false;
  const deps = opts.deps ?? {};
  const m = await requireMouvement(groupId, mouvementId);

  const bloque = blocages(m);
  if (bloque.length > 0) {
    return { ok: false, dryRun, message: `Envoi impossible : ${bloque.join(', ')}.` };
  }

  // N° de pièce toujours envoyé (le sien, sinon son id) : c'est la clé de
  // repli du sync caisse pour reconnaître la ligne Comptaweb.
  const numeroPiece = m.numero_piece || m.id;
  const payload: EcriturePayload = {
    date_ecriture: m.date_mouvement,
    description: m.description,
    amount_cents: Math.abs(m.amount_cents),
    type: m.amount_cents > 0 ? 'recette' : 'depense',
    mode_paiement_id: await modeEspecesId(),
    numero_piece: numeroPiece,
    ventilations: [
      {
        amount_cents: Math.abs(m.amount_cents),
        category_id: m.category_id ?? null,
        unite_id: m.unite_id ?? null,
        activite_id: m.activite_id ?? null,
      },
    ],
  };

  // Validation du brouillon bancaire : même adaptateur, mêmes exigences.
  let input: CreateEcritureInput;
  try {
    input = await buildCwInputFromPayload(payload, deps);
  } catch (err) {
    return { ok: false, dryRun, message: err instanceof Error ? err.message : String(err) };
  }

  const resoudre = deps.resoudreExercice ?? resoudreExercicePourDate;
  const session = deps.withSession ?? withComptaweb;
  const caisseDe = deps.resolveCaisseId ?? resolveCaisseId;
  const creer = deps.createEcriture ?? createEcriture;

  // Session de l'exercice de LA DATE du mouvement (ADR-039), comme la banque.
  const exercice = await resoudre(groupId, m.date_mouvement);
  const result = await session(exercice.cwId, async (cfg) =>
    creer(
      cfg,
      // Ligne de caisse : la caisse du groupe, pas le compte bancaire.
      { ...input, comptebancaireId: undefined, caisseId: String(await caisseDe(cfg)) },
      { dryRun },
    ),
  );

  if (result.dryRun) {
    return { ok: true, dryRun: true, message: 'Preview OK, prêt à envoyer à Comptaweb.' };
  }
  if (!result.ecritureId) {
    throw new Error("Comptaweb n'a pas renvoyé l'id de l'écriture créée.");
  }

  await getDb()
    .prepare(
      `UPDATE mouvements_caisse
          SET status = 'pending_sync', comptaweb_ecriture_id = ?, numero_piece = ?
        WHERE id = ? AND group_id = ?`,
    )
    .run(result.ecritureId, numeroPiece, m.id, groupId);

  return {
    ok: true,
    dryRun: false,
    message: `Envoyé à Comptaweb (id ${result.ecritureId}). Le prochain sync_run le reconnaîtra comme ligne de caisse.`,
    comptawebEcritureId: result.ecritureId,
  };
}

// ─── Complément d'un mouvement pas encore dans Comptaweb ──────────────────
//
// Un brouillon ou un mouvement Baloo-only doit porter nature, unité et
// activité pour partir dans Comptaweb. Un miroir (ou un envoi en attente) ne
// se modifie pas ici : Comptaweb fait foi.

export interface UpdateMouvementCaisseInput {
  date_mouvement?: string;
  description?: string;
  amount_cents?: number;
  category_id?: string | null;
  unite_id?: string | null;
  activite_id?: string | null;
  notes?: string | null;
}

export async function updateMouvementCaisseAvantComptaweb(
  { groupId }: CaisseContext,
  mouvementId: string,
  patch: UpdateMouvementCaisseInput,
): Promise<MouvementCaisse> {
  const m = await requireMouvement(groupId, mouvementId);
  if (m.archived_at) throw new Error(`Le mouvement ${mouvementId} est archivé.`);
  if (m.comptaweb_ecriture_id !== null || m.status === 'pending_sync') {
    throw new Error(
      `Le mouvement ${mouvementId} est déjà dans Comptaweb : c'est là qu'il se modifie.`,
    );
  }
  const champs = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (champs.length === 0) return m;
  await getDb()
    .prepare(
      `UPDATE mouvements_caisse SET ${champs.map(([k]) => `${k} = ?`).join(', ')}
        WHERE id = ? AND group_id = ?`,
    )
    .run(...champs.map(([, v]) => (v === '' ? null : v)), mouvementId, groupId);
  return await requireMouvement(groupId, mouvementId);
}

// ─── Rapprochement avec une ligne de caisse Comptaweb ─────────────────────

export interface RapprochementCaisseResult {
  mouvement: MouvementCaisse;
  // Mouvement miroir qui porte déjà la ligne CW (importé par le sync), s'il
  // existe : le mouvement Baloo-only est alors archivé à son profit.
  rapproche_de: string | null;
  avertissements: string[];
}

export async function rapprocherMouvementCaisseComptaweb(
  { groupId }: CaisseContext,
  mouvementId: string,
  comptawebEcritureId: number,
): Promise<RapprochementCaisseResult> {
  if (!Number.isInteger(comptawebEcritureId) || comptawebEcritureId <= 0) {
    throw new Error(`Id de ligne Comptaweb invalide : ${comptawebEcritureId}.`);
  }
  const db = getDb();
  const m = await requireMouvement(groupId, mouvementId);
  if (m.archived_at) throw new Error(`Le mouvement ${mouvementId} est archivé.`);
  if (m.comptaweb_ecriture_id !== null) {
    throw new Error(
      `Le mouvement ${mouvementId} est déjà lié à la ligne Comptaweb ${m.comptaweb_ecriture_id}.`,
    );
  }

  const miroir = await db
    .prepare(
      `SELECT * FROM mouvements_caisse
        WHERE group_id = ? AND comptaweb_ecriture_id = ? AND archived_at IS NULL AND id <> ?`,
    )
    .get<MouvementRow>(groupId, comptawebEcritureId, mouvementId);

  const avertissements: string[] = [];
  if (miroir) {
    if (miroir.amount_cents !== m.amount_cents) {
      avertissements.push(
        `montants différents : ${m.amount_cents} c (Baloo) / ${miroir.amount_cents} c (Comptaweb)`,
      );
    }
    if (miroir.date_mouvement !== m.date_mouvement) {
      avertissements.push(
        `dates différentes : ${m.date_mouvement} (Baloo) / ${miroir.date_mouvement} (Comptaweb)`,
      );
    }
    // La ligne CW est déjà en base (importée par le sync) : on garde le miroir,
    // complété de l'imputation saisie côté Baloo (sans rien écraser), et on
    // archive le mouvement Baloo-only qui la doublonne.
    await db
      .prepare(
        `UPDATE mouvements_caisse
            SET unite_id = COALESCE(unite_id, ?), activite_id = COALESCE(activite_id, ?),
                notes = COALESCE(notes, ?)
          WHERE id = ?`,
      )
      .run(m.unite_id ?? null, m.activite_id ?? null, m.notes, miroir.id);
    const trace = `Rapproché de la ligne Comptaweb ${comptawebEcritureId} (mouvement ${miroir.id}).`;
    await db
      .prepare(
        `UPDATE mouvements_caisse
            SET archived_at = ?, notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
          WHERE id = ?`,
      )
      .run(currentTimestamp(), trace, trace, m.id);
  } else {
    // Ligne CW pas encore importée : le mouvement en devient le miroir. Le
    // sync caisse le retrouvera par cet id et alignera ses champs sur CW.
    await db
      .prepare(
        `UPDATE mouvements_caisse
            SET comptaweb_ecriture_id = ?,
                status = CASE WHEN status IN ('draft', 'pending_sync') THEN 'saisi' ELSE status END
          WHERE id = ?`,
      )
      .run(comptawebEcritureId, m.id);
  }

  const relu = await requireMouvement(groupId, m.id);
  return { mouvement: relu, rapproche_de: miroir?.id ?? null, avertissements };
}
