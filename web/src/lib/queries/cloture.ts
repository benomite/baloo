import { getCurrentContext } from '../context';
import { getDb } from '../db';
import { ensureDepotsSchema } from '../services/depots';
import { controleEcrituresSansJustif, controleDepotsOrphelins } from '../services/export/controles';
import type { BornesExercice } from '../services/export/bornes';

// Vue "Mois clôturable" : agrège les blocages qui empêcheraient une
// clôture propre du mois sélectionné. Pas d'effet de bord — c'est
// une lecture pure. La clôture effective (verrouillage des écritures,
// notification, etc.) viendra plus tard, à voir si le besoin se
// matérialise.

export interface ClotureBlocker {
  kind: 'ecriture_sans_justif' | 'justif_orphelin' | 'remb_non_termine' | 'abandon_non_termine';
  count: number;
  href: string;
  label: string;
  hint: string;
}

export interface ClotureReport {
  year: number;
  month: number; // 1-12
  monthLabel: string;
  blockers: ClotureBlocker[];
  totalBlocked: number;
}

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

export async function getClotureReport(
  year: number,
  month: number,
): Promise<ClotureReport> {
  const { groupId } = await getCurrentContext();
  await ensureDepotsSchema();
  const db = getDb();

  const monthIdx = month - 1;
  const startDate = `${year}-${pad2(month)}-01`;
  const endDate = endOfMonthIso(year, month);

  // Un mois est une borne comme une autre : les contrôles de l'export
  // prennent leurs bornes en paramètre, donc la même règle métier sert ici
  // et là. Sans ça, "écriture sans justif" aurait deux définitions SQL
  // divergeables. `exercice` reste un libellé libre (pas un code d'exercice
  // comptable "2025-2026") : on le préfixe pour ne pas induire en erreur si
  // la valeur affleure un jour dans un affichage.
  const bornesMois: BornesExercice = {
    exercice: `mois ${year}-${pad2(month)}`,
    debut: startDate,
    fin: endDate,
    finInclusiveTs: `${endDate}T23:59:59Z`,
  };

  const [ecrSansJustif, depotsOrphelins, rembsNonTermine, abandonsNonTermine] =
    await Promise.all([
      controleEcrituresSansJustif(db, groupId, bornesMois),
      // Cumulatif : un dépôt orphelin jamais rattaché doit continuer de
      // bloquer la clôture, même s'il date d'un mois antérieur (cf. I4 —
      // une page "mois clôturable" vit de ce cumul, contrairement au
      // contrôle "écriture sans justif" qui reste mensuel à juste titre).
      controleDepotsOrphelins(db, groupId, bornesMois, { cumulatif: true }),
      db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM remboursements
           WHERE group_id = ?
             AND status NOT IN ('termine', 'refuse')
             AND COALESCE(date_depense, created_at) >= ?
             AND COALESCE(date_depense, created_at) <= ?`,
        )
        .get<{ n: number }>(
          groupId,
          startDate,
          `${endDate}T23:59:59Z`,
        ),
      db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM abandons_frais
           WHERE group_id = ?
             AND status NOT IN ('envoye_national', 'refuse')
             AND date_depense >= ?
             AND date_depense <= ?`,
        )
        .get<{ n: number }>(groupId, startDate, endDate),
    ]);

  const blockers: ClotureBlocker[] = [
    {
      kind: 'ecriture_sans_justif',
      count: ecrSansJustif.lignes.length,
      href: '/inbox?period=tout',
      label: 'écriture(s) sans justif',
      hint: 'Lie un justif depuis l’inbox, ou marque "Pas de justif attendu".',
    },
    {
      kind: 'justif_orphelin',
      count: depotsOrphelins.lignes.length,
      href: '/inbox?period=tout',
      label: 'justif(s) orphelin(s)',
      hint: 'Rattache à une écriture ou rejette depuis l’inbox.',
    },
    {
      kind: 'remb_non_termine',
      count: rembsNonTermine?.n ?? 0,
      href: '/remboursements?status=a_traiter',
      label: 'remboursement(s) non terminé(s)',
      hint: 'Valide ou refuse depuis la fiche.',
    },
    {
      kind: 'abandon_non_termine',
      count: abandonsNonTermine?.n ?? 0,
      href: '/abandons?status=a_traiter',
      label: 'abandon(s) non envoyé(s) au national',
      hint: 'Valide puis envoie au national.',
    },
  ];

  const totalBlocked = blockers.reduce((sum, b) => sum + b.count, 0);
  const monthLabel = `${FRENCH_MONTHS[monthIdx]} ${year}`;

  return { year, month, monthLabel, blockers, totalBlocked };
}

export function previousMonth(today = new Date()): { year: number; month: number } {
  const year = today.getFullYear();
  const month = today.getMonth() + 1; // courant 1-12
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export function buildMonthOptions(today = new Date(), depth = 12): Array<{ year: number; month: number; label: string }> {
  const out: Array<{ year: number; month: number; label: string }> = [];
  for (let i = 0; i < depth; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      label: `${FRENCH_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function endOfMonthIso(year: number, month: number): string {
  // Dernier jour du mois : new Date(y, m, 0) où m est 1-12 (0 = mois précédent)
  const last = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(last)}`;
}
