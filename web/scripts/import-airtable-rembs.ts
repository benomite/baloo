// Import des demandes de remboursement historiques depuis Airtable
// (base VDS-Compta, table REMBOURSEMENT_FRAIS) vers la BDD Baloo.
//
// Idempotent : marque chaque rembs importée avec `[airtable:recXXX]`
// dans `notes`. Au re-run, on skip ce qui est déjà fait.
//
// Cible recommandée : prod Turso direct (la table Airtable n'a pas
// de doublons, on n'a pas besoin de validation locale d'abord).
//
// Usage :
//   cd web
//   AIRTABLE_PAT=pat... AIRTABLE_BASE_ID=app... \
//   DB_URL=libsql://... DB_AUTH_TOKEN=... \
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... \
//   pnpm tsx scripts/import-airtable-rembs.ts [--dry-run]
//
// Ou avec les vars chargées via .env.local :
//   set -a; source .env.local; set +a
//   pnpm import:airtable-rembs --dry-run

import { ensureComptawebEnv } from '../src/lib/comptaweb/env-loader';
import { getDb } from '../src/lib/db';
import { attachJustificatif } from '../src/lib/services/justificatifs';
import { nextId, currentTimestamp } from '../src/lib/ids';

const TABLE_ID = 'tblztYODXfgkRRcwX';

// Mapping par ID de champ (stable même si le label Airtable bouge).
const F = {
  libelle: 'fldwRujKlp2FNZdzA',
  status: 'fldu5JbHV0svgJUR6',
  prenom: 'fldyFYjCJ10lB8RB2',
  nom: 'fld3IsLvt07yJboyD',
  valeur: 'fldfSFx5eMcARF5Im',
  email: 'fldfHm3q6aMdU4lEY',
  feuille: 'fldwWzqt8169zKScO',
  justificatifs: 'fldWqI2I8i1KXpjdd',
  ribFichier: 'fldJV03ReMJ2mfZPc',
  ribTexte: 'fldQpTjtqOLgHYZCE',
  editToken: 'fldsmsRe91HoKjhNH',
  validateToken: 'fld1oGuBlLFwTOOGa',
} as const;

interface AirtableAttachment {
  id: string;
  url: string;
  filename: string;
  type?: string | null;
  size?: number;
}

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

async function downloadFile(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

interface ImportStats {
  imported: number;
  skipped: number;
  failed: number;
}

async function main() {
  ensureComptawebEnv();

  if (!process.env.DB_URL) {
    console.error('DB_URL requis (Turso prod). Sinon le script écrirait sur la BDD locale.');
    console.error('Voir doc/deployment.md pour récupérer DB_URL + DB_AUTH_TOKEN.');
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN requis (Vercel Blob prod, sinon on écrit sur le FS local).');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const db = getDb();

  // Groupe cible (1 seul groupe en prod actuellement).
  const group = await db.prepare('SELECT id FROM groupes LIMIT 1').get<{ id: string }>();
  if (!group) throw new Error('Aucun groupe en BDD — bootstrap manquant ?');
  const groupId = group.id;

  // Sources déjà importées (idempotence via tag dans notes).
  const existing = await db
    .prepare("SELECT notes FROM remboursements WHERE notes LIKE '%[airtable:%'")
    .all<{ notes: string }>();
  const importedIds = new Set<string>();
  for (const row of existing) {
    const m = row.notes.match(/\[airtable:(rec[\w]+)\]/);
    if (m) importedIds.add(m[1]);
  }

  console.log(
    `Cible : ${process.env.DB_URL ? 'Turso (' + process.env.DB_URL + ')' : 'SQLite local'}`,
  );
  console.log(`Groupe : ${groupId}`);
  console.log(`Déjà importés : ${importedIds.size}`);
  console.log();

  const records = await fetchAllRecords();
  console.log(`${records.length} record(s) Airtable trouvés.\n`);

  const stats: ImportStats = { imported: 0, skipped: 0, failed: 0 };

  for (const rec of records) {
    if (importedIds.has(rec.id)) {
      stats.skipped++;
      console.log(`  · ${rec.id} — déjà importé, skip`);
      continue;
    }

    const f = rec.fields;
    const libelle = (f[F.libelle] as string | undefined)?.trim() || 'Sans libellé';
    const prenom = ((f[F.prenom] as string | undefined) ?? '').trim() || null;
    const nom = ((f[F.nom] as string | undefined) ?? '').trim() || null;
    const email = ((f[F.email] as string | undefined) ?? '').trim() || null;
    const valeur = (f[F.valeur] as number | undefined) ?? 0;
    const amountCents = Math.round(valeur * 100);
    const ribTexte = ((f[F.ribTexte] as string | undefined) ?? '').trim() || null;
    const editToken = ((f[F.editToken] as string | undefined) ?? '').trim() || null;
    const validateToken = ((f[F.validateToken] as string | undefined) ?? '').trim() || null;
    const justifs = (f[F.justificatifs] as AirtableAttachment[] | undefined) ?? [];
    const feuille = (f[F.feuille] as AirtableAttachment[] | undefined) ?? [];
    const ribFichier = (f[F.ribFichier] as AirtableAttachment[] | undefined) ?? [];
    const createdDate = rec.createdTime.slice(0, 10); // YYYY-MM-DD
    const demandeur = [prenom, nom].filter(Boolean).join(' ') || 'Inconnu';

    if (amountCents === 0) {
      console.warn(`  ⚠ ${rec.id} a un montant à 0 — import quand même.`);
    }

    if (dryRun) {
      console.log(
        `[DRY] ${rec.id} → ${demandeur} · ${libelle} · ${valeur.toFixed(2)}€ · ${justifs.length} justifs · ${feuille.length} feuille(s) · ${ribFichier.length} rib`,
      );
      stats.imported++;
      continue;
    }

    try {
      const newId = await nextId('RBT');
      const now = currentTimestamp();
      const notes = `Importé depuis Airtable [airtable:${rec.id}] le ${now.slice(0, 10)}.`;

      await db
        .prepare(
          `INSERT INTO remboursements (
            id, group_id, demandeur, prenom, nom, email, rib_texte,
            amount_cents, total_cents, date_depense, nature,
            justificatif_status, status, comptaweb_synced, notes,
            edit_token, validate_token, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          groupId,
          demandeur,
          prenom,
          nom,
          email,
          ribTexte,
          amountCents,
          amountCents,
          createdDate,
          libelle,
          'oui',
          'termine',
          1,
          notes,
          editToken,
          validateToken,
          now,
          now,
        );

      // Ligne unique (cf. modèle multi-lignes — Airtable n'avait que mono).
      const ligneId = `rbtl-airtable-${rec.id}`;
      await db
        .prepare(
          `INSERT INTO remboursement_lignes (id, remboursement_id, date_depense, amount_cents, nature, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ligneId, newId, createdDate, amountCents, libelle, now);

      // Justificatifs : tickets, factures, reçus.
      for (const j of justifs) {
        try {
          const buffer = await downloadFile(j.url);
          await attachJustificatif(
            { groupId },
            {
              entity_type: 'remboursement',
              entity_id: newId,
              filename: j.filename,
              content: buffer,
              mime_type: j.type ?? null,
            },
          );
        } catch (err) {
          console.warn(`    ⚠ justif ${j.filename} : ${err instanceof Error ? err.message : err}`);
        }
      }

      // Feuille de remboursement : traitée comme un justif normal pour
      // l'historique (cf. décision : pas d'entity_type dédié).
      for (const ff of feuille) {
        try {
          const buffer = await downloadFile(ff.url);
          await attachJustificatif(
            { groupId },
            {
              entity_type: 'remboursement',
              entity_id: newId,
              filename: ff.filename,
              content: buffer,
              mime_type: ff.type ?? null,
            },
          );
        } catch (err) {
          console.warn(`    ⚠ feuille ${ff.filename} : ${err instanceof Error ? err.message : err}`);
        }
      }

      // RIB fichier (entity_type spécial + rib_file_path).
      if (ribFichier.length > 0) {
        try {
          const r = ribFichier[0];
          const buffer = await downloadFile(r.url);
          await attachJustificatif(
            { groupId },
            {
              entity_type: 'remboursement_rib',
              entity_id: newId,
              filename: r.filename,
              content: buffer,
              mime_type: r.type ?? null,
            },
          );
          await db
            .prepare('UPDATE remboursements SET rib_file_path = ? WHERE id = ?')
            .run(`remboursement_rib/${newId}/${r.filename}`, newId);
        } catch (err) {
          console.warn(`    ⚠ rib : ${err instanceof Error ? err.message : err}`);
        }
      }

      stats.imported++;
      console.log(
        `✓ ${newId} ← ${rec.id} · ${demandeur} · ${libelle} · ${valeur.toFixed(2)}€ · ${justifs.length + feuille.length} fichier(s)`,
      );
    } catch (err) {
      stats.failed++;
      console.error(`✗ ${rec.id} : ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log();
  console.log(
    `Bilan : ${stats.imported} importé(s)${dryRun ? ' (simulés)' : ''} · ${stats.skipped} déjà présent(s) · ${stats.failed} échec(s).`,
  );
  if (stats.failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
