import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb, nextId, formatAmount, currentTimestamp } from '../db.js';
import { getCurrentContext } from '../context.js';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';

type Row = Record<string, string>;

function parseComptawebCsv(content: string): { rows: Row[]; errors: string[] } {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], errors: ['Fichier vide ou invalide'] };

  const headers = lines[0].split(';').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows: Row[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';').map(v => v.trim().replace(/^"|"$/g, ''));
    if (values.length < headers.length) {
      errors.push(`Ligne ${i + 1}: nombre de colonnes insuffisant`);
      continue;
    }
    const row: Row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
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
  'Caisse (dépôt)': 'mp-caisse',
  'Carte bancaire': 'mp-cb-sgdf',
  'Carte procurement': 'mp-cb-sgdf',
  'Prélèvement': 'mp-prelevement',
};

// Mapping Branche/Pôle Comptaweb → code unité
const BRANCHE_TO_CODE: Record<string, string> = {
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

// Groupement des lignes par N° de pièce (normalisé en majuscules) ou par (date + intitulé + compte + montant)
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
      // Les lignes Ecriture et Ventilation ne partagent pas les mêmes montants
      // (montant en Dépense/Recette côté Ecriture, en Dépense/Recette ventilation côté Ventilation).
      // On regroupe donc par date + intitulé + compte uniquement.
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

export function registerComptawebTools(server: McpServer) {
  server.tool(
    'import_comptaweb_csv',
    'Importe un export CSV Comptaweb (gestion courante recettes/dépenses) : remplit les tables de staging ET crée les écritures dans la table principale avec status=saisie_comptaweb. Idempotent par N° de pièce.',
    {
      csv_path: z.string().describe('Chemin vers le fichier CSV (typiquement dans inbox/)'),
    },
    (params) => {
      if (!existsSync(params.csv_path)) {
        return { content: [{ type: 'text', text: `Fichier non trouvé : ${params.csv_path}` }] };
      }

      let content: string;
      try {
        content = readFileSync(params.csv_path, 'latin1');
      } catch {
        try {
          content = readFileSync(params.csv_path, 'utf-8');
        } catch (e) {
          return { content: [{ type: 'text', text: `Erreur lecture fichier : ${e}` }] };
        }
      }

      const { rows, errors } = parseComptawebCsv(content);
      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `Aucune ligne parsée. Erreurs : ${errors.join(', ')}` }] };
      }

      const db = getDb();
      const importId = nextId('CWI');
      const now = currentTimestamp();
      const sourceFile = basename(params.csv_path);

      // Pré-charge référentiels pour mapping catégorie/unité/activité
      const categoriesByNature = new Map<string, string>();
      for (const c of db.prepare(`SELECT id, comptaweb_nature FROM categories WHERE comptaweb_nature IS NOT NULL`).all() as { id: string; comptaweb_nature: string }[]) {
        categoriesByNature.set(normalize(c.comptaweb_nature), c.id);
      }
      const unitesByCode = new Map<string, string>();
      for (const u of db.prepare(`SELECT id, code FROM unites`).all() as { id: string; code: string }[]) {
        unitesByCode.set(u.code, u.id);
      }
      const activites = db.prepare(`SELECT id, name FROM activites`).all() as { id: string; name: string }[];

      function findCategoryId(nature: string): string | null {
        if (!nature) return null;
        const n = normalize(nature);
        if (categoriesByNature.has(n)) return categoriesByNature.get(n)!;
        // Matching tolérant : essayer sans ponctuation terminale ou variantes
        for (const [key, id] of categoriesByNature) {
          if (key.startsWith(n) || n.startsWith(key)) return id;
        }
        return null;
      }

      function findActiviteId(activite: string): string | null {
        if (!activite) return null;
        const n = normalize(activite);
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

      // Compteur local pour éviter les appels nextId() répétés
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

      const { groupId } = getCurrentContext();
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
        // 1. Meta import d'abord (FK de comptaweb_lignes)
        db.prepare(`
          INSERT INTO comptaweb_imports (id, group_id, import_date, source_file, row_count, total_depenses_cents, total_recettes_cents, notes, created_at)
          VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
        `).run(importId, groupId, now.split('T')[0], sourceFile, rows.length,
          errors.length > 0 ? errors.join('\n') : null, now);

        // 2. Staging : remplir comptaweb_lignes
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
            JSON.stringify(row)
          );
        }

        // 2. Idempotence : purge globale des écritures saisie_comptaweb
        deleteAllSynced.run();

        // 3. Groupement des lignes Ecriture+Ventilation
        const groups = groupRows(rows);

        // 4. Création des écritures
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
          const piece = g.piece; // normalisé uppercase

          const depEcr = parseFrenchAmount(ecrLine['Dépense'] || '');
          const recEcr = parseFrenchAmount(ecrLine['Recette'] || '');
          const ecrAmount = depEcr || recEcr;
          const ecrType: 'depense' | 'recette' = depEcr > 0 ? 'depense' : 'recette';

          const vents = g.ventilations;
          const notesBase = `Import Comptaweb ${importId}`;

          if (vents.length === 0) {
            // Écriture sans ventilation → 1 ecriture simple (branche éventuelle depuis l'écriture elle-même)
            const branche = ecrLine['Branche/Pôle'] || '';
            const nature = ecrLine['Nature'] || '';
            const activite = ecrLine['Activité'] || ecrLine['Activite'] || '';
            const uniteId = findUniteId(piece, branche);
            const categoryId = findCategoryId(nature);
            const activiteId = findActiviteId(activite);

            insertEcriture.run(
              nextEcrId(), groupId, uniteId, date, intitule, ecrAmount, ecrType,
              categoryId, modeId, activiteId, piece,
              notesBase, now, now
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

              // Transfert interne (depV ET recV remplis, ex. dépôt espèces en banque)
              // → neutre pour le compte de résultat, on ne crée pas d'écriture.
              // La ligne reste dans comptaweb_lignes pour trace.
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
                notesBase + suffix, now, now
              );
              ecrCreees++;
              if (!uniteId) ecrSansUnite++;
              if (!categoryId) ecrSansCategorie++;
              if (!modeId) ecrSansMode++;
              if (!piece) ecrSansPiece++;
            }
          }
        }

        // 5. Mettre à jour totaux de l'import meta
        db.prepare(`
          UPDATE comptaweb_imports SET total_depenses_cents = ?, total_recettes_cents = ? WHERE id = ?
        `).run(totalDepensesCents, totalRecettesCents, importId);
      });

      runAll();

      // Totaux réels dans ecritures (hors transferts internes)
      const totEcr = db.prepare(`SELECT type, COALESCE(SUM(amount_cents),0) as s FROM ecritures WHERE status='saisie_comptaweb' GROUP BY type`).all() as { type: string; s: number }[];
      const depsEcr = totEcr.find(t => t.type === 'depense')?.s ?? 0;
      const recsEcr = totEcr.find(t => t.type === 'recette')?.s ?? 0;

      const result = {
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

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}
