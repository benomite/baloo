// Dump technique complet : toutes les tables + tous les fichiers.
//
//   pnpm export:dump                    -> ./baloo-dump-YYYY-MM-DD/
//   pnpm export:dump /chemin/de/sortie
//
// Filet de sécurité, pas archive de passation : le contenu est FIDÈLE (RIB et
// tokens compris) et reste chez le trésorier. Cf. ADR-040.
//
// Reprenable : un blob est écrit dans un fichier temporaire (`.part`) puis
// `rename`é vers son nom final une fois l'écriture terminée — `rename` est
// atomique sur un même système de fichiers, donc un fichier présent sous
// son nom final est forcément complet. Relancer après une coupure (réseau,
// Ctrl-C, disque plein) ne retéléchargera donc jamais un fichier déjà
// intégralement écrit, et ne laissera jamais passer un fichier tronqué pour
// complet.
//
// Un blob manquant du store n'interrompt pas le dump : il est consigné dans
// manifest.json (`blobs.manquants`) et le dump continue — un fichier perdu
// ne doit pas empêcher de sauvegarder les autres.
import { mkdir, writeFile, stat, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { getDb } from '../src/lib/db';
import { getStorage } from '../src/lib/storage';
import { TABLES_INCLUSES, TABLES_EXCLUES, classifierTables } from '../src/lib/services/export/tables';
import { collecterTable } from '../src/lib/services/export/collecte';
import { controleBlobsManquants } from '../src/lib/services/export/controles';
import { getCliContext } from './cli-context';

async function main() {
  const jour = new Date().toISOString().slice(0, 10);
  const racine = process.argv[2] ?? `./baloo-dump-${jour}`;
  const { groupId } = await getCliContext();
  const db = getDb();
  const storage = getStorage();

  // Garde-fou : une table non classée ne doit pas passer inaperçue.
  const toutes = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  const { manquantes } = classifierTables(toutes.map((t) => t.name));
  if (manquantes.length > 0) {
    throw new Error(
      `Tables non classées dans export/tables.ts : ${manquantes.join(', ')}.\n` +
        `Ajoute-les à TABLES_INCLUSES ou à TABLES_EXCLUES avant d'exporter.`,
    );
  }

  await mkdir(join(racine, 'tables'), { recursive: true });
  const compteurs: Record<string, number> = {};
  for (const t of TABLES_INCLUSES) {
    const rows = await collecterTable(db, groupId, t);
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n');
    await writeFile(join(racine, 'tables', `${t.nom}.jsonl`), jsonl + (rows.length ? '\n' : ''), 'utf-8');
    compteurs[t.nom] = rows.length;
    console.log(`  ${t.nom.padEnd(36)} ${rows.length}`);
  }

  // Les blobs : écrits sous leur id (stable), avec un index qui garde le nom
  // d'origine et de quoi vérifier l'intégrité.
  const justifs = await db
    .prepare(
      `SELECT id, file_path, original_filename, mime_type, entity_type, entity_id
         FROM justificatifs WHERE group_id = ? ORDER BY id`,
    )
    .all<{
      id: string;
      file_path: string;
      original_filename: string | null;
      mime_type: string | null;
      entity_type: string | null;
      entity_id: string | null;
    }>(groupId);

  await mkdir(join(racine, 'blobs'), { recursive: true });
  const index: Array<Record<string, unknown>> = [];
  const manquants: Array<{ id: string; file_path: string; original_filename: string | null }> = [];
  let telecharges = 0;
  let sautes = 0;
  for (const j of justifs) {
    const ext = (j.original_filename?.match(/\.[a-z0-9]+$/i) ?? [''])[0];
    const cible = join(racine, 'blobs', `${j.id}${ext}`);
    let octets: number;
    try {
      octets = (await stat(cible)).size;
      sautes += 1;
    } catch {
      // `storage.fetch` avale toute exception (réseau, auth, timeout) et
      // renvoie null exactement comme pour un fichier réellement absent —
      // impossible de distinguer les deux cas ici. D'où l'avertissement de
      // proportion posé plus bas sur `manquants`.
      const res = await storage.fetch(j.file_path);
      if (!res) {
        // Fichier référencé en base mais absent du store (ou store
        // injoignable, cf. commentaire ci-dessus) : on consigne et on
        // continue, ce n'est pas un motif d'arrêt du dump.
        manquants.push({ id: j.id, file_path: j.file_path, original_filename: j.original_filename });
        continue;
      }
      const buf = await toBuffer(res.body);
      const partiel = `${cible}.part`;
      await mkdir(dirname(cible), { recursive: true });
      await unlink(partiel).catch(() => {}); // .part résiduel d'un run interrompu précédent
      await writeFile(partiel, buf);
      await rename(partiel, cible); // atomique : le fichier final n'apparaît que complet
      octets = buf.byteLength;
      telecharges += 1;
    }
    index.push({ ...j, fichier: `blobs/${j.id}${ext}`, octets });
  }
  await writeFile(join(racine, 'blobs', 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

  // `manquants` a été constitué à partir d'un `storage.fetch` déjà résolu à
  // null pendant la boucle ci-dessus : pas de second accès réseau ici,
  // `existe` répond juste ce qu'on sait déjà.
  const controleBlobs = await controleBlobsManquants(manquants, async () => false);
  if (controleBlobs.lignes.length > 0) {
    console.warn(`\n⚠️  ${controleBlobs.lignes.length} fichier(s) introuvable(s) dans le store (cf. manifest.json).`);
  }

  // `storage.fetch` ne distingue pas un fichier réellement absent d'une
  // erreur de lecture (réseau, auth, timeout) : les deux renvoient null. Une
  // proportion massive de "manquants" ressemble donc bien plus à une panne
  // d'accès au store qu'à une perte réelle de fichiers — on le signale
  // explicitement plutôt que de laisser croire à une hécatombe de pièces.
  let avertissement: string | null = null;
  if (justifs.length > 0 && manquants.length > justifs.length / 2) {
    avertissement =
      `${manquants.length} fichier(s) sur ${justifs.length} sont ressortis "manquants" — une telle ` +
      `proportion indique plus probablement un problème d'accès au store (réseau, authentification) ` +
      `qu'une perte réelle de fichiers. Vérifie l'accès au store et relance le dump avant de conclure.`;
    console.warn(`\n⚠️  ${avertissement}`);
  }

  const manifest = {
    genere_le: new Date().toISOString(),
    group_id: groupId,
    commit: gitCommit(),
    lignes_par_table: compteurs,
    blobs: {
      total: justifs.length,
      telecharges,
      deja_presents: sautes,
      manquants: {
        nombre: controleBlobs.lignes.length,
        lignes: manquants,
      },
      ...(avertissement ? { avertissement } : {}),
    },
    tables_exclues: TABLES_EXCLUES,
  };
  await writeFile(join(racine, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nDump écrit dans ${racine} (${justifs.length} fichiers, ${telecharges} téléchargés).`);
}

async function toBuffer(body: Uint8Array | ReadableStream<Uint8Array>): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function gitCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
