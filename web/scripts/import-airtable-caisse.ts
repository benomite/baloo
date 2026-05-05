// Import des mouvements de caisse historiques depuis Airtable
// (base VDS-Compta, table CAISSE) vers la BDD Baloo.
//
// Idempotent : marque chaque ligne avec son `airtable_id` (recXXX).
// Re-run skip ce qui existe déjà.
//
// Mapping :
// - Type=Entrée → INSERT mouvements_caisse (montant positif, type='entree')
// - Type=Dépot  → INSERT depots_especes + INSERT mouvements_caisse
//                 (montant négatif, type='depot', depot_id rempli)
// - Status Comptaweb → status interne :
//     "Todo" / "Noté en Caisse" → 'saisi'
//     "Noté Déposé"             → 'depose'
//     "Rapproché"               → 'rapproche'
// - N° Justif. (Airtable) → numero_piece
//
// Usage :
//   cd web
//   AIRTABLE_PAT=pat... AIRTABLE_BASE_ID=app... \
//   pnpm tsx scripts/import-airtable-caisse.ts [--dry-run]
//
// Cible par défaut : BDD locale (web/data/baloo.db). Pour cibler la prod,
// passer DB_URL + DB_AUTH_TOKEN.

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';
import { ensureAuthSchema } from '../src/lib/auth/schema';
import { createDepotEspeces } from '../src/lib/services/depots-especes';
import { createMouvementCaisse } from '../src/lib/services/caisse';
import type { MouvementCaisseStatus } from '../src/lib/types';

const TABLE_ID = 'tblU4HLv8mQ4wDOCk';

// Mapping par ID de champ (stable même si le label Airtable bouge).
const F = {
  libelle: 'flddBe0YonaLoTm7C',
  date: 'fldFWEwoMW4zP5Xra',
  type: 'fldCYqjFiEVqFuOJF',
  montant_total: 'fldQRqhEgEHydFUWv',
  caisse: 'fldANknvO3h5ddmeM',
  status: 'fldLNAwwK1bAFAA54',
  num_justif: 'fldBA8YZcaoGLvCQ8',
  notes: 'flduVpfLKfGZMLPxw',
  montant_depose: 'flduAhdPK91dpNDA3',
} as const;

interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

interface AirtableListResponse {
  records: AirtableRecord[];
  offset?: string;
}

async function fetchAllRecords(): Promise<AirtableRecord[]> {
  const pat = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!pat || !baseId) {
    throw new Error('AIRTABLE_PAT et AIRTABLE_BASE_ID requis (cf. .env racine).');
  }

  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ returnFieldsByFieldId: 'true' });
    if (offset) params.set('offset', offset);
    const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ID}?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) {
      throw new Error(`Airtable API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as AirtableListResponse;
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

function mapStatus(airtableStatus?: string): MouvementCaisseStatus {
  switch (airtableStatus) {
    case 'Noté Déposé':
      return 'depose';
    case 'Rapproché':
      return 'rapproche';
    case 'Todo':
    case 'Noté en Caisse':
    default:
      return 'saisi';
  }
}

interface ImportStats {
  imported: number;
  skipped: number;
  failed: number;
  depots: number;
}

async function main() {
  ensureComptawebEnv();
  await ensureAuthSchema();

  const dryRun = process.argv.includes('--dry-run');
  const db = getDb();

  // Groupe cible (1 seul groupe en prod actuellement).
  const group = await db.prepare('SELECT id FROM groupes LIMIT 1').get<{ id: string }>();
  if (!group) throw new Error('Aucun groupe en BDD — bootstrap manquant ?');
  const groupId = group.id;

  console.log(
    `Cible : ${process.env.DB_URL ? 'Turso (' + process.env.DB_URL + ')' : 'SQLite local'}`,
  );
  console.log(`Groupe : ${groupId}`);
  if (dryRun) console.log('Mode : DRY RUN — rien ne sera écrit.');
  console.log();

  const records = await fetchAllRecords();
  console.log(`${records.length} record(s) Airtable trouvés.\n`);

  // Tri par date asc puis createdTime asc pour reproduire l'ordre
  // chronologique du grand livre (et donc un solde_apres_cents cohérent).
  records.sort((a, b) => {
    const da = (a.fields[F.date] as string | undefined) ?? a.createdTime.slice(0, 10);
    const db_ = (b.fields[F.date] as string | undefined) ?? b.createdTime.slice(0, 10);
    if (da !== db_) return da.localeCompare(db_);
    return a.createdTime.localeCompare(b.createdTime);
  });

  const stats: ImportStats = { imported: 0, skipped: 0, failed: 0, depots: 0 };

  for (const rec of records) {
    const f = rec.fields;
    const libelle = ((f[F.libelle] as string | undefined) ?? '').trim() || 'Sans libellé';
    const date = (f[F.date] as string | undefined) ?? rec.createdTime.slice(0, 10);
    const typeField = f[F.type] as string | undefined;
    const statusField = f[F.status] as string | undefined;
    const montantTotal = (f[F.montant_total] as number | undefined) ?? 0;
    const numJustif = ((f[F.num_justif] as string | undefined) ?? '').trim() || null;
    const notes = ((f[F.notes] as string | undefined) ?? '').trim() || null;

    if (!typeField) {
      console.warn(`  ⚠ ${rec.id} sans type (raw=${JSON.stringify(f[F.type])}) — skip`);
      stats.failed++;
      continue;
    }

    // Idempotence : check si déjà importé via airtable_id.
    const existing = await db
      .prepare('SELECT id FROM mouvements_caisse WHERE group_id = ? AND airtable_id = ?')
      .get<{ id: string }>(groupId, rec.id);
    if (existing) {
      stats.skipped++;
      continue;
    }

    const isEntree = typeField === 'Entrée';
    const isDepot = typeField === 'Dépot';

    if (!isEntree && !isDepot) {
      console.warn(`  ⚠ ${rec.id} type inconnu "${typeField}" — skip`);
      stats.failed++;
      continue;
    }

    const status = mapStatus(statusField);
    const amountCents = Math.round(Math.abs(montantTotal) * 100);

    if (amountCents === 0) {
      console.warn(`  ⚠ ${rec.id} montant à 0 — skip`);
      stats.failed++;
      continue;
    }

    if (dryRun) {
      console.log(
        `[DRY] ${rec.id} · ${date} · ${typeField} · ${(montantTotal).toFixed(2)}€ · ${numJustif ?? '—'} · ${status}`,
      );
      stats.imported++;
      if (isDepot) stats.depots++;
      continue;
    }

    try {
      if (isDepot) {
        // Crée d'abord le dépôt espèces, puis le mouvement caisse négatif lié.
        const depot = await createDepotEspeces(
          { groupId },
          {
            date_depot: date,
            total_amount_cents: amountCents,
            airtable_id: rec.id,
            notes,
          },
        );
        await createMouvementCaisse(
          { groupId },
          {
            date_mouvement: date,
            description: libelle,
            amount_cents: -amountCents,
            type: 'depot',
            numero_piece: numJustif,
            status,
            depot_id: depot.id,
            airtable_id: rec.id,
            notes,
          },
        );
        stats.depots++;
      } else {
        // Entrée simple.
        await createMouvementCaisse(
          { groupId },
          {
            date_mouvement: date,
            description: libelle,
            amount_cents: amountCents,
            type: 'entree',
            numero_piece: numJustif,
            status,
            airtable_id: rec.id,
            notes,
          },
        );
      }
      stats.imported++;
      console.log(
        `✓ ${rec.id} · ${date} · ${typeField} · ${montantTotal.toFixed(2)}€ · ${status}`,
      );
    } catch (err) {
      stats.failed++;
      console.error(`✗ ${rec.id} : ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log();
  console.log(
    `Bilan : ${stats.imported} importé(s)${dryRun ? ' (simulés)' : ''} · ${stats.skipped} déjà présent(s) · ${stats.failed} échec(s) · dont ${stats.depots} dépôt(s).`,
  );

  // Solde théorique pour vérification.
  if (!dryRun) {
    const soldeRow = await db
      .prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM mouvements_caisse WHERE group_id = ?')
      .get<{ total: number }>(groupId);
    const solde = (soldeRow?.total ?? 0) / 100;
    console.log(`Solde caisse après import : ${solde.toFixed(2)} €`);
  }

  if (stats.failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
