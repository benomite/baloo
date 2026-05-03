import {
  listEcritures,
  type EcritureFilters,
} from '@/lib/services/ecritures';
import { requireApiContext } from '@/lib/api/route-helpers';
import { listCategories, listUnites, listModesPaiement, listActivites } from '@/lib/services/reference';

// Export CSV des écritures avec les mêmes filtres que la page
// /ecritures. Renvoie un text/csv téléchargé directement par le
// navigateur (Content-Disposition attachment).
//
// Limite à 10000 lignes pour éviter les exports gigantesques. Au-delà,
// l'admin doit affiner ses filtres (période, type, etc.).

const MAX_ROWS = 10_000;

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Échappement RFC 4180 : si le champ contient virgule, guillemet ou
  // saut de ligne, on entoure de guillemets et on double les guillemets
  // internes.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatAmountCsv(cents: number): string {
  // Format français pour Excel FR : virgule décimale, pas de séparateur
  // milliers (Excel l'ajoute lui-même selon la locale du poste).
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export async function GET(request: Request) {
  const ctxR = await requireApiContext(request);
  if ('error' in ctxR) return ctxR.error;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters: EcritureFilters = {
    type: params.type as EcritureFilters['type'],
    unite_id: params.unite_id || undefined,
    category_id: params.category_id || undefined,
    carte_id: params.carte_id || undefined,
    mode_paiement_id: params.mode_paiement_id || undefined,
    month: params.month || undefined,
    date_debut: params.date_debut || undefined,
    date_fin: params.date_fin || undefined,
    status: params.status as EcritureFilters['status'],
    search: params.search || undefined,
    incomplete: params.incomplete === '1',
    from_bank: params.from_bank === '1',
    limit: MAX_ROWS,
  };

  const { groupId, scopeUniteId } = ctxR.ctx;
  const [{ ecritures }, categories, unites, modesPaiement, activites] = await Promise.all([
    listEcritures({ groupId, scopeUniteId }, filters),
    listCategories(),
    listUnites({ groupId }),
    listModesPaiement(),
    listActivites({ groupId }),
  ]);

  // Maps id → label pour résoudre les FK dans le CSV (plus utile pour
  // l'admin qui ouvre dans Excel).
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const un = new Map(unites.map((u) => [u.id, `${u.code} — ${u.name}`]));
  const mp = new Map(modesPaiement.map((m) => [m.id, m.name]));
  const ac = new Map(activites.map((a) => [a.id, a.name]));

  const headers = [
    'id',
    'date',
    'type',
    'description',
    'montant',
    'unite',
    'categorie',
    'mode_paiement',
    'activite',
    'statut',
    'numero_piece',
    'comptaweb_id',
    'justif_attendu',
    'notes',
  ];

  const rows = ecritures.map((e) =>
    [
      e.id,
      e.date_ecriture,
      e.type,
      e.description,
      formatAmountCsv(e.amount_cents),
      e.unite_id ? un.get(e.unite_id) ?? '' : '',
      e.category_id ? cat.get(e.category_id) ?? '' : '',
      e.mode_paiement_id ? mp.get(e.mode_paiement_id) ?? '' : '',
      e.activite_id ? ac.get(e.activite_id) ?? '' : '',
      e.status,
      e.numero_piece ?? '',
      e.comptaweb_ecriture_id ?? '',
      e.justif_attendu ? 'oui' : 'non',
      e.notes ?? '',
    ]
      .map(escapeCsv)
      .join(','),
  );

  // BOM UTF-8 pour qu'Excel reconnaisse l'encodage tout seul (sinon
  // les accents partent en charabia à l'ouverture).
  const csv = '﻿' + [headers.join(','), ...rows].join('\r\n');

  const today = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ecritures-${today}.csv"`,
    },
  });
}
