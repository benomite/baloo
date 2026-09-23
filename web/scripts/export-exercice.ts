// Dossier d'archive d'un exercice, lisible sans Baloo.
//
//   pnpm export:exercice 2025-2026
//   pnpm export:exercice 2025-2026 /chemin/de/sortie
//
// Destiné au Drive du groupe : le contenu est CAVIARDÉ (ni RIB, ni tokens
// d'accès). Cf. ADR-040.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb, type DbWrapper } from '../src/lib/db';
import { buildCsv, formatAmountCsv } from '../src/lib/csv';
import { bornesPourExercice, type BornesExercice } from '../src/lib/services/export/bornes';
import { rapportControles, formatRapportTexte } from '../src/lib/services/export/controles';
import { collecterTable } from '../src/lib/services/export/collecte';
import { TABLES_INCLUSES } from '../src/lib/services/export/tables';
import { getCliContext } from './cli-context';

const REFERENTIELS = [
  'unites', 'categories', 'activites', 'modes_paiement',
  'comptes_bancaires', 'cartes', 'camps', 'personnes',
];

async function main() {
  const exercice = process.argv[2];
  if (!exercice) throw new Error('Usage : pnpm export:exercice <exercice> [sortie]\nEx. : pnpm export:exercice 2025-2026');
  const bornes = bornesPourExercice(exercice);
  const racine = process.argv[3] ?? `./exercice-${exercice}`;
  const { groupId } = await getCliContext();
  const db = getDb();

  for (const d of [
    '01-ecritures', '02-remboursements', '03-abandons', '04-caisse',
    '05-depots-orphelins', '06-referentiels', '07-memoire', '08-comptaweb',
  ]) {
    await mkdir(join(racine, d), { recursive: true });
  }

  // 1. Les contrôles d'abord : ils ouvrent le README, c'est ce qu'on lit en
  //    premier en rouvrant l'archive dans trois ans.
  const controles = await rapportControles(db, groupId, bornes);

  // 2. Les référentiels : sans eux, les CSV ne contiennent que des ids.
  for (const nom of REFERENTIELS) {
    const t = TABLES_INCLUSES.find((x) => x.nom === nom);
    if (!t) throw new Error(`Référentiel ${nom} absent de TABLES_INCLUSES`);
    const rows = await collecterTable(db, groupId, t, { caviarder: true });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['id'];
    await writeFile(
      join(racine, '06-referentiels', `${nom}.csv`),
      buildCsv(headers, rows.map((r) => headers.map((h) => r[h]))),
      'utf-8',
    );
  }

  // 3. Les CSV de chaque section, bornés à l'exercice.
  await ecrireEcritures(db, groupId, bornes, racine);
  await ecrireRemboursements(db, groupId, bornes, racine);
  await ecrireAbandons(db, groupId, bornes, racine);
  await ecrireCaisse(db, groupId, bornes, racine);
  await ecrireAvancesCamp(db, groupId, bornes, racine);
  await ecrireMemoire(db, groupId, racine);

  // 4. Le README, avec les contrôles en tête.
  await writeFile(
    join(racine, 'README.md'),
    [
      `# Archive de l'exercice ${exercice}`,
      '',
      `Groupe : ${groupId} · Période : ${bornes.debut} → ${bornes.fin}`,
      `Export généré le ${new Date().toISOString().slice(0, 10)} par \`pnpm export:exercice\`.`,
      '',
      'Les RIB et les liens d’accès direct aux remboursements ont été retirés de cette archive.',
      '',
      'Les abandons de frais ne font pas l’objet d’une signature électronique dans Baloo : seules ' +
        'les demandes de remboursement le sont (cf. `02-remboursements/signatures.csv`).',
      '',
      '## Contrôles de cohérence',
      '',
      '```',
      formatRapportTexte(controles, bornes),
      '```',
      '',
    ].join('\n'),
    'utf-8',
  );

  console.log(`Dossier écrit dans ${racine}.`);
}

// Le `status` est une colonne à part entière du CSV : c'est ce qui permet à
// un lecteur de voir qu'une écriture n'était pas matérialisée dans Comptaweb
// au moment de l'archivage.
async function ecrireEcritures(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
  racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT e.id, e.date_ecriture, e.type, e.description, e.amount_cents,
              u.code AS unite, c.name AS categorie, m.name AS mode_paiement,
              a.name AS activite, e.status, e.numero_piece,
              e.comptaweb_ecriture_id, e.justif_attendu, e.notes
         FROM ecritures e
         LEFT JOIN unites u ON u.id = e.unite_id
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN modes_paiement m ON m.id = e.mode_paiement_id
         LEFT JOIN activites a ON a.id = e.activite_id
        WHERE e.group_id = ? AND e.date_ecriture >= ? AND e.date_ecriture <= ?
        ORDER BY e.date_ecriture, e.id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);

  const headers = [
    'id', 'date', 'type', 'description', 'montant', 'unite', 'categorie',
    'mode_paiement', 'activite', 'statut', 'numero_piece', 'comptaweb_id',
    'justif_attendu', 'notes',
  ];
  await writeFile(
    join(racine, '01-ecritures', 'ecritures.csv'),
    buildCsv(headers, rows.map((r) => [
      r.id, r.date_ecriture, r.type, r.description,
      formatAmountCsv(Number(r.amount_cents ?? 0)),
      r.unite ?? '', r.categorie ?? '', r.mode_paiement ?? '', r.activite ?? '',
      r.status, r.numero_piece ?? '', r.comptaweb_ecriture_id ?? '',
      r.justif_attendu ? 'oui' : 'non', r.notes ?? '',
    ])),
    'utf-8',
  );
}

// Jamais `rib_texte`, `rib_file_path`, `edit_token`, `validate_token` : ce
// sont les colonnes que `caviardage.ts` retire des tables collectées via
// `collecterTable`, mais cette requête est écrite à la main et ne passe pas
// par ce filtre — elle ne doit donc jamais les sélectionner.
async function ecrireRemboursements(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
  racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT r.id, r.demandeur, r.email, r.total_cents, r.date_depense, r.created_at,
              r.nature, u.code AS unite, r.status, r.date_paiement, r.ecriture_id,
              EXISTS (
                SELECT 1 FROM justificatifs j
                 WHERE j.entity_type = 'remboursement_feuille'
                   AND j.entity_id = r.id
                   AND j.obsolete_at IS NULL
              ) AS feuille_signee
         FROM remboursements r
         LEFT JOIN unites u ON u.id = r.unite_id
        WHERE r.group_id = ?
          AND COALESCE(r.date_depense, r.created_at) >= ?
          AND COALESCE(r.date_depense, r.created_at) <= ?
        ORDER BY COALESCE(r.date_depense, r.created_at), r.id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.finInclusiveTs);

  const headers = [
    'id', 'demandeur', 'email', 'montant', 'date', 'nature', 'unite',
    'statut', 'date_paiement', 'ecriture_liee', 'feuille_signee',
  ];
  await writeFile(
    join(racine, '02-remboursements', 'remboursements.csv'),
    buildCsv(headers, rows.map((r) => [
      r.id, r.demandeur, r.email ?? '',
      formatAmountCsv(Number(r.total_cents ?? 0)),
      r.date_depense ?? (r.created_at ? String(r.created_at).slice(0, 10) : ''),
      r.nature ?? '', r.unite ?? '', r.status, r.date_paiement ?? '',
      r.ecriture_id ?? '', r.feuille_signee ? 'oui' : 'non',
    ])),
    'utf-8',
  );

  await ecrireSignatures(db, groupId, 'remboursement', '02-remboursements', racine);
}

async function ecrireAbandons(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
  racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT a.id, a.donateur, a.email, a.amount_cents, a.date_depense, a.nature,
              u.code AS unite, a.annee_fiscale, a.status, a.motif_refus,
              a.cerfa_emis, a.cerfa_emis_at, a.notes
         FROM abandons_frais a
         LEFT JOIN unites u ON u.id = a.unite_id
        WHERE a.group_id = ? AND a.date_depense >= ? AND a.date_depense <= ?
        ORDER BY a.date_depense, a.id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);

  const headers = [
    'id', 'donateur', 'email', 'montant', 'date', 'nature', 'unite',
    'annee_fiscale', 'statut', 'motif_refus', 'cerfa_emis', 'cerfa_emis_le', 'notes',
  ];
  await writeFile(
    join(racine, '03-abandons', 'abandons.csv'),
    buildCsv(headers, rows.map((r) => [
      r.id, r.donateur, r.email ?? '',
      formatAmountCsv(Number(r.amount_cents ?? 0)),
      r.date_depense, r.nature, r.unite ?? '', r.annee_fiscale, r.status,
      r.motif_refus ?? '', r.cerfa_emis ? 'oui' : 'non', r.cerfa_emis_at ?? '', r.notes ?? '',
    ])),
    'utf-8',
  );

  // Pas de signatures.csv ici : aucun abandon n'est jamais signé
  // électroniquement dans Baloo (seule `document_type = 'remboursement'`
  // existe en base). Un fichier vide laisserait croire à des preuves
  // manquantes plutôt qu'à un process sans signature.
}

async function ecrireCaisse(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
  racine: string,
) {
  const mouvements = await db
    .prepare(
      `SELECT m.id, m.date_mouvement, m.description, m.amount_cents, m.type,
              m.numero_piece, m.status, u.code AS unite, a.name AS activite, m.notes
         FROM mouvements_caisse m
         LEFT JOIN unites u ON u.id = m.unite_id
         LEFT JOIN activites a ON a.id = m.activite_id
        WHERE m.group_id = ? AND m.date_mouvement >= ? AND m.date_mouvement <= ?
        ORDER BY m.date_mouvement, m.id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);
  await writeFile(
    join(racine, '04-caisse', 'mouvements.csv'),
    buildCsv(
      ['id', 'date', 'description', 'montant', 'type', 'numero_piece', 'statut', 'unite', 'activite', 'notes'],
      mouvements.map((r) => [
        r.id, r.date_mouvement, r.description,
        formatAmountCsv(Number(r.amount_cents ?? 0)),
        r.type ?? '', r.numero_piece ?? '', r.status, r.unite ?? '', r.activite ?? '', r.notes ?? '',
      ]),
    ),
    'utf-8',
  );

  const depotsEspeces = await db
    .prepare(
      `SELECT id, date_depot, total_amount_cents, detail_billets, ecriture_id, notes
         FROM depots_especes
        WHERE group_id = ? AND date_depot >= ? AND date_depot <= ?
        ORDER BY date_depot, id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);
  await writeFile(
    join(racine, '04-caisse', 'depots-especes.csv'),
    buildCsv(
      ['id', 'date', 'montant', 'detail_billets', 'ecriture_liee', 'notes'],
      depotsEspeces.map((r) => [
        r.id, r.date_depot, formatAmountCsv(Number(r.total_amount_cents ?? 0)),
        r.detail_billets ?? '', r.ecriture_id ?? '', r.notes ?? '',
      ]),
    ),
    'utf-8',
  );

  const depotsCheques = await db
    .prepare(
      `SELECT id, date_depot, type_depot, total_amount_cents, nombre_cheques,
              detail_cheques, confirmation_status, notes
         FROM depots_cheques
        WHERE group_id = ? AND date_depot >= ? AND date_depot <= ?
        ORDER BY date_depot, id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);
  await writeFile(
    join(racine, '04-caisse', 'depots-cheques.csv'),
    buildCsv(
      ['id', 'date', 'type_depot', 'montant', 'nombre_cheques', 'detail_cheques', 'statut_confirmation', 'notes'],
      depotsCheques.map((r) => [
        r.id, r.date_depot, r.type_depot, formatAmountCsv(Number(r.total_amount_cents ?? 0)),
        r.nombre_cheques, r.detail_cheques ?? '', r.confirmation_status, r.notes ?? '',
      ]),
    ),
    'utf-8',
  );
}

// avances_camp porte sa propre colonne group_id (cf. camp-avances.ts) : la
// jointure vers camps ne sert qu'à afficher le nom du camp, pas à borner.
async function ecrireAvancesCamp(
  db: DbWrapper,
  groupId: string,
  bornes: BornesExercice,
  racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT av.id, c.name AS camp, av.beneficiaire, av.montant_cents,
              av.montant_rendu_cents, av.mode, av.statut, av.ecriture_id, av.notes
         FROM avances_camp av
         LEFT JOIN camps c ON c.id = av.camp_id
        WHERE av.group_id = ? AND av.date_versement >= ? AND av.date_versement <= ?
        ORDER BY av.date_versement, av.id`,
    )
    .all<Record<string, unknown>>(groupId, bornes.debut, bornes.fin);

  const headers = [
    'id', 'camp', 'beneficiaire', 'montant_verse', 'montant_rendu',
    'mode', 'statut', 'ecriture_liee', 'notes',
  ];
  await writeFile(
    join(racine, 'avances-camp.csv'),
    buildCsv(headers, rows.map((r) => [
      r.id, r.camp ?? '', r.beneficiaire,
      formatAmountCsv(Number(r.montant_cents ?? 0)),
      r.montant_rendu_cents != null ? formatAmountCsv(Number(r.montant_rendu_cents)) : '',
      r.mode, r.statut, r.ecriture_id ?? '', r.notes ?? '',
    ])),
    'utf-8',
  );
}

// La chaîne de signature est la valeur probante : sans elle, un PDF signé
// n'est qu'un PDF. Elle est donc exportée à côté des documents, pas
// seulement imprimée dans l'encart du PDF. Une signature `superseded_at`
// non nulle est périmée (la demande a été éditée après validation) mais
// reste exportée comme trace d'audit — la colonne le dit explicitement.
async function ecrireSignatures(
  db: DbWrapper, groupId: string,
  documentType: 'remboursement' | 'abandon', dossier: string, racine: string,
) {
  const rows = await db
    .prepare(
      `SELECT s.* FROM signatures s
         JOIN ${documentType === 'remboursement' ? 'remboursements' : 'abandons_frais'} d
           ON d.id = s.document_id
        WHERE s.document_type = ? AND d.group_id = ?
        ORDER BY s.document_id, s.server_timestamp`,
    )
    .all<Record<string, unknown>>(documentType, groupId);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : ['document_id'];
  await writeFile(
    join(racine, dossier, 'signatures.csv'),
    buildCsv(headers, rows.map((r) => headers.map((h) => r[h]))),
    'utf-8',
  );
}

async function ecrireMemoire(db: DbWrapper, groupId: string, racine: string) {
  const notes = await db
    .prepare(
      `SELECT topic, title, content_md, created_at
         FROM notes
        WHERE group_id = ?
        ORDER BY topic, created_at`,
    )
    .all<{ topic: string; title: string | null; content_md: string; created_at: string }>(groupId);
  const notesMd = [
    '# Notes',
    '',
    ...notes.flatMap((n) => [
      `## ${n.title ?? '(sans titre)'}`,
      '',
      `_${n.created_at.slice(0, 10)} · ${n.topic}_`,
      '',
      n.content_md,
      '',
    ]),
  ];
  if (notes.length === 0) notesMd.push('Aucune note.');
  await writeFile(join(racine, '07-memoire', 'notes.md'), notesMd.join('\n'), 'utf-8');

  const todos = await db
    .prepare(
      `SELECT title, description, status, due_date
         FROM todos
        WHERE group_id = ?
        ORDER BY status, due_date`,
    )
    .all<{ title: string; description: string | null; status: string; due_date: string | null }>(groupId);
  const todosMd = [
    '# Todos',
    '',
    ...todos.map((t) => {
      const coche = t.status === 'fait' ? 'x' : ' ';
      const echeance = t.due_date ? ` (échéance ${t.due_date})` : '';
      const description = t.description ? ` — ${t.description}` : '';
      return `- [${coche}] ${t.title}${echeance}${description}`;
    }),
  ];
  if (todos.length === 0) todosMd.push('Aucune todo.');
  await writeFile(join(racine, '07-memoire', 'todos.md'), todosMd.join('\n'), 'utf-8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
