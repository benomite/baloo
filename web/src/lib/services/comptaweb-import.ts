import { getDb } from '../db';
import { nextId, currentTimestamp } from '../ids';
import { formatAmount } from '../format';

export interface ComptawebImportContext {
  groupId: string;
}

export interface ImportCsvInput {
  filename: string;
  content: string;
}

export interface ImportCsvResult {
  ok: boolean;
  message?: string;
  import_id?: string;
  fichier?: string;
  lignes_csv?: number;
  ecritures_creees?: number;
  transferts_internes?: number;
  transferts_internes_montant?: string;
  sans_unite?: number;
  sans_categorie?: number;
  sans_mode_paiement?: number;
  sans_piece?: number;
  total_depenses_ecr?: string;
  total_recettes_ecr?: string;
  solde_ecr?: string;
  total_depenses_csv?: string;
  total_recettes_csv?: string;
  erreurs_parse?: string[] | null;
  warnings?: string[] | null;
  warnings_total?: number;
}

type Row = Record<string, string>;

function parseComptawebCsv(content: string): { rows: Row[]; errors: string[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ['Fichier vide ou invalide'] };

  const headers = lines[0].split(';').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Row[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map((v) => v.trim().replace(/^"|"$/g, ''));
    if (values.length < headers.length) {
      errors.push(`Ligne ${i + 1}: nombre de colonnes insuffisant`);
      continue;
    }
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return { rows, errors };
}

function parseFrenchAmount(text: string): number {
  if (!text || text.trim() === '') return 0;
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function parseFrenchDate(text: string): string | null {
  if (!text || text.trim() === '') return null;
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

// Mapping Mode de transaction Comptaweb → id modes_paiement (seed générique)
const MODE_CSV_TO_ID: Record<string, string> = {
  'Virement': 'mp-virement',
  'Chèque': 'mp-chequier',
  'Espèces': 'mp-caisse',
  'Carte bancaire': 'mp-cb-sgdf',
  'Carte procurement': 'mp-cb-sgdf',
  'Prélèvement': 'mp-virement',
};

const BRANCHE_TO_CODE: Record<string, string> = {
  'Sangliers': 'SA',
  'Farfadets': 'FA',
  'Louveteaux-Jeannettes': 'LJ',
  'Scouts-Guides': 'SG',
  'Pionniers-Caravelles': 'PC',
  'Compagnons': 'CO',
  'Impeesas': 'IM',
};

function uniteCodeFromPiece(piece: string): string | null {
  if (!piece) return null;
  const m = piece.trim().toUpperCase().match(/^([A-Z]{2})/);
  if (!m) return null;
  const code = m[1];
  return ['SA', 'FA', 'LJ', 'SG', 'PC', 'CO', 'IM'].includes(code) ? code : null;
}

function normalize(s: string): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

type LineGroup = { ecriture: Row | null; ventilations: Row[]; piece: string | null };

function groupRows(rows: Row[]): Map<string, LineGroup> {
  const groups = new Map<string, LineGroup>();
  for (const row of rows) {
    const pieceRaw = (row['N° de pièce'] || '').trim();
    const piece = pieceRaw ? pieceRaw.toUpperCase() : null;
    const typeLigne = row['Type'] || '';

    let key: string;
    if (piece) {
      key = `PIECE::${piece}`;
    } else {
      const date = row['Date'] || '';
      const intitule = row['Intitulé'] || row['Intitule'] || '';
      const compte = row['Compte bancaire 1'] || '';
      key = `NOPIECE::${date}::${intitule}::${compte}`;
    }

    let g = groups.get(key);
    if (!g) {
      g = { ecriture: null, ventilations: [], piece };
      groups.set(key, g);
    }
    if (typeLigne === 'Ecriture') {
      g.ecriture = row;
    } else if (typeLigne === 'Ventilation') {
      g.ventilations.push(row);
    } else if (!g.ecriture) {
      g.ecriture = row;
    }
  }
  return groups;
}

export function importComptawebCsv(
  { groupId }: ComptawebImportContext,
  { filename, content }: ImportCsvInput,
): ImportCsvResult {
  const { rows, errors } = parseComptawebCsv(content);
  if (rows.length === 0) {
    return { ok: false, message: `Aucune ligne parsée. Erreurs : ${errors.join(', ')}` };
  }

  const db = getDb();
  const importId = nextId('CWI');
  const now = currentTimestamp();
  const sourceFile = filename;

  // Lookup catégories / activités / unités côté local pour mapper les IDs.
  const categories = db.prepare(`SELECT id, name FROM categories`).all() as { id: string; name: string }[];
  const categoriesByName = new Map(categories.map((c) => [normalize(c.name), c.id]));

  const activites = db.prepare(`SELECT id, name FROM activites WHERE group_id = ?`).all(groupId) as { id: string; name: string }[];
  const activitesByName = new Map(activites.map((a) => [normalize(a.name), a.id]));

  const unites = db.prepare(`SELECT id, code FROM unites WHERE group_id = ?`).all(groupId) as { id: string; code: string }[];
  const unitesByCode = new Map(unites.map((u) => [u.code, u.id]));

  function findCategoryId(name: string): string | null {
    const n = normalize(name);
    if (!n) return null;
    if (categoriesByName.has(n)) return categoriesByName.get(n)!;
    for (const c of categories) {
      const cn = normalize(c.name);
      if (n.startsWith(cn) || cn.startsWith(n)) return c.id;
      if (n.includes(cn) || cn.includes(n)) return c.id;
    }
    return null;
  }

  function findActiviteId(name: string): string | null {
    const n = normalize(name);
    if (!n) return null;
    if (activitesByName.has(n)) return activitesByName.get(n)!;
    for (const a of activites) {
      const an = normalize(a.name);
      if (an === n) return a.id;
      if (n.startsWith(an) || an.startsWith(n)) return a.id;
      if (n.includes(an) || an.includes(n)) return a.id;
    }
    return null;
  }

  function findUniteId(piece: string | null, branche: string): string | null {
    const fromPiece = piece ? uniteCodeFromPiece(piece) : null;
    if (fromPiece && unitesByCode.has(fromPiece)) return unitesByCode.get(fromPiece)!;
    const brCode = BRANCHE_TO_CODE[branche];
    if (brCode && unitesByCode.has(brCode)) return unitesByCode.get(brCode)!;
    return null;
  }

  // Compteur local pour éviter les appels nextId() répétés (perf).
  const existingIds = db.prepare(`SELECT id FROM ecritures WHERE id LIKE ? ORDER BY id DESC LIMIT 1`).get(`ECR-%`) as { id: string } | undefined;
  let seqNum = existingIds ? parseInt(existingIds.id.split('-').pop()!, 10) : 0;
  const currentYear = new Date().getFullYear();
  function nextEcrId(): string {
    seqNum++;
    return `ECR-${currentYear}-${String(seqNum).padStart(4, '0')}`;
  }

  const insertLigne = db.prepare(`
    INSERT INTO comptaweb_lignes (import_id, date_ecriture, intitule, depense_cents, recette_cents, mode_transaction, type_ligne, nature, activite, branche, numero_piece, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Idempotence : on purge TOUTES les écritures saisie_comptaweb avant ré-import.
  // Les ajustements manuels (status=brouillon ou valide) ne sont pas touchés.
  const deleteAllSynced = db.prepare(`DELETE FROM ecritures WHERE status = 'saisie_comptaweb'`);

  const insertEcriture = db.prepare(`
    INSERT INTO ecritures (id, group_id, unite_id, date_ecriture, description, amount_cents, type, category_id, mode_paiement_id, activite_id, numero_piece, status, comptaweb_synced, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saisie_comptaweb', 1, ?, ?, ?)
  `);

  let totalDepensesCents = 0;
  let totalRecettesCents = 0;
  let ecrCreees = 0;
  let ecrSansUnite = 0;
  let ecrSansCategorie = 0;
  let ecrSansMode = 0;
  let ecrSansPiece = 0;
  let transfertsInternes = 0;
  let transfertsInternesCents = 0;
  const warnings: string[] = [];

  const runAll = db.transaction(() => {
    db.prepare(`
      INSERT INTO comptaweb_imports (id, group_id, import_date, source_file, row_count, total_depenses_cents, total_recettes_cents, notes, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).run(
      importId,
      groupId,
      now.split('T')[0],
      sourceFile,
      rows.length,
      errors.length > 0 ? errors.join('\n') : null,
      now,
    );

    for (const row of rows) {
      const depCents = parseFrenchAmount(row['Dépense'] ?? '');
      const recCents = parseFrenchAmount(row['Recette'] ?? '');
      totalDepensesCents += depCents;
      totalRecettesCents += recCents;

      insertLigne.run(
        importId,
        parseFrenchDate(row['Date'] ?? ''),
        row['Intitulé'] ?? row['Intitule'] ?? '',
        depCents || null,
        recCents || null,
        row['Mode de transaction'] ?? '',
        row['Type'] ?? '',
        row['Nature'] ?? '',
        row['Activité'] ?? row['Activite'] ?? '',
        row['Branche/Pôle'] ?? '',
        row['N° de pièce'] ?? '',
        JSON.stringify(row),
      );
    }

    deleteAllSynced.run();

    const groups = groupRows(rows);

    for (const [, g] of groups) {
      const ecrLine = g.ecriture;
      if (!ecrLine) {
        warnings.push(`Groupe ${g.piece ?? '(sans pièce)'} : aucune ligne Ecriture`);
        continue;
      }
      const date = parseFrenchDate(ecrLine['Date'] || '');
      if (!date) {
        warnings.push(`Groupe ${g.piece ?? '(sans pièce)'} : date illisible`);
        continue;
      }
      const intitule = ecrLine['Intitulé'] || ecrLine['Intitule'] || '';
      const mode = ecrLine['Mode de transaction'] || '';
      const modeId = MODE_CSV_TO_ID[mode] || null;
      const piece = g.piece;

      const depEcr = parseFrenchAmount(ecrLine['Dépense'] || '');
      const recEcr = parseFrenchAmount(ecrLine['Recette'] || '');
      const ecrAmount = depEcr || recEcr;
      const ecrType: 'depense' | 'recette' = depEcr > 0 ? 'depense' : 'recette';

      const vents = g.ventilations;
      const notesBase = `Import Comptaweb ${importId}`;

      if (vents.length === 0) {
        const branche = ecrLine['Branche/Pôle'] || '';
        const nature = ecrLine['Nature'] || '';
        const activite = ecrLine['Activité'] || ecrLine['Activite'] || '';
        const uniteId = findUniteId(piece, branche);
        const categoryId = findCategoryId(nature);
        const activiteId = findActiviteId(activite);

        insertEcriture.run(
          nextEcrId(), groupId, uniteId, date, intitule, ecrAmount, ecrType,
          categoryId, modeId, activiteId, piece,
          notesBase, now, now,
        );
        ecrCreees++;
        if (!uniteId) ecrSansUnite++;
        if (!categoryId) ecrSansCategorie++;
        if (!modeId) ecrSansMode++;
        if (!piece) ecrSansPiece++;
      } else {
        for (const v of vents) {
          const depV = parseFrenchAmount(v['Dépense ventilation'] || v['Dépense'] || '');
          const recV = parseFrenchAmount(v['Recette ventilation'] || v['Recette'] || '');
          if (!depV && !recV) {
            warnings.push(`Ventilation sans montant (pièce ${piece ?? '—'}, ${intitule})`);
            continue;
          }
          const nature = v['Nature'] || '';
          const activite = v['Activité'] || v['Activite'] || '';
          const branche = v['Branche/Pôle'] || '';
          const categoryId = findCategoryId(nature);
          const activiteId = findActiviteId(activite);
          const uniteId = findUniteId(piece, branche);
          const suffix = branche ? ` — ${branche}` : '';

          // Transfert interne (depV ET recV remplis, ex. dépôt espèces en banque) —
          // neutre pour le compte de résultat, on ne crée pas d'écriture. La ligne
          // reste dans comptaweb_lignes pour trace.
          if (depV > 0 && recV > 0) {
            transfertsInternesCents += depV;
            transfertsInternes++;
            continue;
          }

          const type: 'depense' | 'recette' = depV > 0 ? 'depense' : 'recette';
          const amt = depV || recV;
          insertEcriture.run(
            nextEcrId(), groupId, uniteId, date, intitule, amt, type,
            categoryId, modeId, activiteId, piece,
            notesBase + suffix, now, now,
          );
          ecrCreees++;
          if (!uniteId) ecrSansUnite++;
          if (!categoryId) ecrSansCategorie++;
          if (!modeId) ecrSansMode++;
          if (!piece) ecrSansPiece++;
        }
      }
    }

    db.prepare(`UPDATE comptaweb_imports SET total_depenses_cents = ?, total_recettes_cents = ? WHERE id = ?`)
      .run(totalDepensesCents, totalRecettesCents, importId);
  });

  runAll();

  // Totaux réels dans ecritures (hors transferts internes).
  const totEcr = db.prepare(`SELECT type, COALESCE(SUM(amount_cents),0) as s FROM ecritures WHERE status='saisie_comptaweb' AND group_id = ? GROUP BY type`).all(groupId) as { type: string; s: number }[];
  const depsEcr = totEcr.find((t) => t.type === 'depense')?.s ?? 0;
  const recsEcr = totEcr.find((t) => t.type === 'recette')?.s ?? 0;

  return {
    ok: true,
    import_id: importId,
    fichier: sourceFile,
    lignes_csv: rows.length,
    ecritures_creees: ecrCreees,
    transferts_internes: transfertsInternes,
    transferts_internes_montant: formatAmount(transfertsInternesCents),
    sans_unite: ecrSansUnite,
    sans_categorie: ecrSansCategorie,
    sans_mode_paiement: ecrSansMode,
    sans_piece: ecrSansPiece,
    total_depenses_ecr: formatAmount(depsEcr),
    total_recettes_ecr: formatAmount(recsEcr),
    solde_ecr: formatAmount(recsEcr - depsEcr),
    total_depenses_csv: formatAmount(totalDepensesCents),
    total_recettes_csv: formatAmount(totalRecettesCents),
    erreurs_parse: errors.length > 0 ? errors : null,
    warnings: warnings.length > 0 ? warnings.slice(0, 20) : null,
    warnings_total: warnings.length,
  };
}
