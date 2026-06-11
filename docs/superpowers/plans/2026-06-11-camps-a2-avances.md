# Camps — Phase A2 : avances de trésorerie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Suivre les avances de trésorerie versées aux chefs pour un camp : versement, statut, clôture avec reliquat rendu, et garde-fou anti-double-comptage (le virement d'avance est un transfert, pas une dépense du camp).

**Architecture:** Cf. spec `docs/superpowers/specs/2026-06-10-camps-design.md` § table `avances_camp`. Nouveau service lazy-init `camp-avances.ts` (pattern `camps.ts`), module **pur** `camp-avances-logic.ts` (validation clôture + résumé, TDD), actions ajoutées à `actions/camps.ts`, section « Avances de trésorerie » sur `/camps/[id]`. Une avance versée n'est PAS une dépense du camp — ce sont les tickets du chef (dépôts → écritures) qui comptent. L'écriture du virement est liée en traçabilité (`ecriture_id`) et la page signale si elle est imputée à l'activité du camp (double comptage).

**Tech Stack:** Next 16, libsql, Tailwind, vitest. Commandes depuis `web/` avec binaires locaux (`cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`, idem eslint/vitest).

---

## Structure des fichiers

| Fichier | Action |
|---|---|
| `web/src/lib/services/camp-avances-logic.ts` (+ `.test.ts`) | Créer — validation clôture + résumé (pur, TDD) |
| `web/src/lib/services/camp-avances.ts` | Créer — schema lazy, create/list/cloture/rouvrir, candidates écriture |
| `web/src/lib/actions/camps.ts` | Modifier — actions createAvanceCamp / cloturerAvanceCamp / rouvrirAvanceCamp |
| `web/src/app/(app)/camps/[id]/page.tsx` | Modifier — section Avances de trésorerie |

**Réalité des tests :** TDD réel sur `camp-avances-logic.ts` (pur). Service/actions/page : `tsc` + `eslint` + suite vitest (non-régression) + contrôle visuel.

**Règles projet rappelées :** JAMAIS de DELETE (une avance erronée se rouvre/s'annote, ne se supprime pas) ; pas de CHECK SQL sur `statut`/`mode` (validation code) ; **ids via `nextIdOn(getDb(), 'AVC', { tables: ['avances_camp'] })`** (piège #11 : `nextId` ne scanne pas les nouvelles tables) ; FK : champs de form vides → `null` (jamais `""`) ; admin re-vérifié côté serveur dans chaque action.

---

### Task 1 : Module pur `camp-avances-logic.ts` (TDD)

**Files:** Create `web/src/lib/services/camp-avances-logic.ts`, `web/src/lib/services/camp-avances-logic.test.ts`

- [ ] **Step 1 : Tests qui échouent** — créer `camp-avances-logic.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { validateCloture, buildAvancesSummary, type AvanceLike } from './camp-avances-logic';

const avance = (over: Partial<AvanceLike> = {}): AvanceLike => ({
  montant_cents: 30000,
  montant_rendu_cents: null,
  statut: 'versee',
  ...over,
});

describe('validateCloture', () => {
  it('accepte un rendu entre 0 et le montant', () => {
    expect(validateCloture(30000, 0)).toBeNull();
    expect(validateCloture(30000, 4250)).toBeNull();
    expect(validateCloture(30000, 30000)).toBeNull();
  });
  it('refuse un rendu négatif ou NaN', () => {
    expect(validateCloture(30000, -1)).toMatch(/invalide/i);
    expect(validateCloture(30000, NaN)).toMatch(/invalide/i);
  });
  it('refuse un rendu supérieur au montant versé', () => {
    expect(validateCloture(30000, 30001)).toMatch(/dépasser/i);
  });
  it('refuse un rendu non entier (centimes)', () => {
    expect(validateCloture(30000, 42.5)).toMatch(/invalide/i);
  });
});

describe('buildAvancesSummary', () => {
  it('liste vide → tout à zéro', () => {
    expect(buildAvancesSummary([])).toEqual({
      totalVerseCents: 0,
      enCirculationCents: 0,
      totalRenduCents: 0,
      consommeCents: 0,
      enCoursCount: 0,
    });
  });
  it('avance versée non clôturée = en circulation', () => {
    const s = buildAvancesSummary([avance()]);
    expect(s.totalVerseCents).toBe(30000);
    expect(s.enCirculationCents).toBe(30000);
    expect(s.totalRenduCents).toBe(0);
    expect(s.consommeCents).toBe(0);
    expect(s.enCoursCount).toBe(1);
  });
  it('avance clôturée : consommé = versé - rendu', () => {
    const s = buildAvancesSummary([
      avance({ statut: 'cloturee', montant_rendu_cents: 4250 }),
    ]);
    expect(s.enCirculationCents).toBe(0);
    expect(s.totalRenduCents).toBe(4250);
    expect(s.consommeCents).toBe(25750);
    expect(s.enCoursCount).toBe(0);
  });
  it('mix versées + clôturées : sommes correctes', () => {
    const s = buildAvancesSummary([
      avance(),
      avance({ montant_cents: 10000, statut: 'cloturee', montant_rendu_cents: 1000 }),
    ]);
    expect(s.totalVerseCents).toBe(40000);
    expect(s.enCirculationCents).toBe(30000);
    expect(s.totalRenduCents).toBe(1000);
    expect(s.consommeCents).toBe(9000);
    expect(s.enCoursCount).toBe(1);
  });
  it('clôturée sans rendu renseigné → rendu compté 0', () => {
    const s = buildAvancesSummary([
      avance({ statut: 'cloturee', montant_rendu_cents: null }),
    ]);
    expect(s.totalRenduCents).toBe(0);
    expect(s.consommeCents).toBe(30000);
  });
});
```

- [ ] **Step 2 : FAIL** — `cd web && ./node_modules/.bin/vitest run src/lib/services/camp-avances-logic.test.ts` → échec « Cannot find module ».

- [ ] **Step 3 : Implémenter** — créer `camp-avances-logic.ts` :

```ts
// Logique pure des avances de trésorerie d'un camp (spec 2026-06-10, A2).
// Une avance versée à un chef est un TRANSFERT, pas une dépense du camp :
// ce sont les tickets payés sur l'avance qui comptent (dépôts → écritures).
// Ici : validation de clôture (reliquat rendu) + résumé pour l'affichage.

export type AvanceStatut = 'versee' | 'cloturee';

export interface AvanceLike {
  montant_cents: number;
  montant_rendu_cents: number | null;
  statut: AvanceStatut;
}

export interface AvancesSummary {
  totalVerseCents: number;
  enCirculationCents: number; // avances versées non clôturées
  totalRenduCents: number;
  consommeCents: number; // clôturées : versé - rendu
  enCoursCount: number;
}

export function validateCloture(
  montantCents: number,
  renduCents: number,
): string | null {
  if (!Number.isInteger(renduCents) || renduCents < 0) {
    return 'Montant rendu invalide.';
  }
  if (renduCents > montantCents) {
    return 'Le montant rendu ne peut pas dépasser le montant de l’avance.';
  }
  return null;
}

export function buildAvancesSummary(avances: AvanceLike[]): AvancesSummary {
  const s: AvancesSummary = {
    totalVerseCents: 0,
    enCirculationCents: 0,
    totalRenduCents: 0,
    consommeCents: 0,
    enCoursCount: 0,
  };
  for (const a of avances) {
    s.totalVerseCents += a.montant_cents;
    if (a.statut === 'cloturee') {
      const rendu = a.montant_rendu_cents ?? 0;
      s.totalRenduCents += rendu;
      s.consommeCents += a.montant_cents - rendu;
    } else {
      s.enCirculationCents += a.montant_cents;
      s.enCoursCount += 1;
    }
  }
  return s;
}
```

- [ ] **Step 4 : PASS** — relancer le test (9 cas verts).
- [ ] **Step 5 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/camp-avances-logic.ts web/src/lib/services/camp-avances-logic.test.ts
git commit -m "feat(camps): camp-avances-logic — validation clôture + résumé (TDD)"
```

---

### Task 2 : Service `camp-avances.ts`

**Files:** Create `web/src/lib/services/camp-avances.ts`

- [ ] **Step 1 : Créer le service** (pattern lazy-init de `camps.ts` ; **ids via `nextIdOn` avec `tables: ['avances_camp']`** — piège #11) :

```ts
import { getDb } from '../db';
import { nextIdOn, currentTimestamp } from '../ids';
import { ensureCampsSchema, getCamp, type CampContext } from './camps';
import {
  validateCloture,
  buildAvancesSummary,
  type AvanceStatut,
  type AvancesSummary,
} from './camp-avances-logic';

// Avances de trésorerie d'un camp (spec 2026-06-10, A2). Une avance est
// un transfert vers le chef, PAS une dépense du camp — l'écriture du
// virement (ecriture_id, traçabilité) ne doit pas être imputée à
// l'activité du camp, sinon double comptage avec les tickets.

let schemaEnsured = false;
export async function ensureAvancesSchema(): Promise<void> {
  if (schemaEnsured) return;
  // FK vers camps : la table camps doit exister d'abord.
  await ensureCampsSchema();
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS avances_camp (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES groupes(id),
      camp_id TEXT NOT NULL REFERENCES camps(id),
      beneficiaire TEXT NOT NULL,
      montant_cents INTEGER NOT NULL,
      date_versement TEXT,
      mode TEXT NOT NULL DEFAULT 'virement',
      ecriture_id TEXT REFERENCES ecritures(id),
      statut TEXT NOT NULL DEFAULT 'versee',
      montant_rendu_cents INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_avances_camp ON avances_camp(camp_id);
  `);
  schemaEnsured = true;
}

export const AVANCE_MODES = ['virement', 'especes'] as const;
export type AvanceMode = (typeof AVANCE_MODES)[number];

export interface AvanceCamp {
  id: string;
  group_id: string;
  camp_id: string;
  beneficiaire: string;
  montant_cents: number;
  date_versement: string | null;
  mode: AvanceMode;
  ecriture_id: string | null;
  statut: AvanceStatut;
  montant_rendu_cents: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joints (écriture du virement, traçabilité)
  ecriture_description?: string | null;
  ecriture_date?: string | null;
  ecriture_activite_id?: string | null;
  // calculé : l'écriture du virement est imputée à l'activité du camp
  // → double comptage avec les tickets du chef, à corriger.
  double_comptage?: boolean;
}

export interface CampAvances {
  avances: AvanceCamp[];
  summary: AvancesSummary;
}

export async function createAvance(
  ctx: CampContext,
  input: {
    camp_id: string;
    beneficiaire: string;
    montant_cents: number;
    date_versement?: string | null;
    mode: AvanceMode;
    ecriture_id?: string | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  await ensureAvancesSchema();
  const camp = await getCamp(ctx, input.camp_id);
  if (!camp) return { ok: false, error: 'Camp introuvable.' };
  if (!(AVANCE_MODES as readonly string[]).includes(input.mode)) {
    return { ok: false, error: `Mode invalide : ${input.mode}.` };
  }
  if (!Number.isInteger(input.montant_cents) || input.montant_cents <= 0) {
    return { ok: false, error: 'Montant invalide.' };
  }
  // nextId historique ne scanne pas les nouvelles tables (piège #11).
  const id = await nextIdOn(getDb(), 'AVC', { tables: ['avances_camp'] });
  await getDb()
    .prepare(
      `INSERT INTO avances_camp (id, group_id, camp_id, beneficiaire, montant_cents, date_versement, mode, ecriture_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, ctx.groupId, input.camp_id, input.beneficiaire.trim(),
      input.montant_cents, input.date_versement || null, input.mode,
      input.ecriture_id || null, input.notes?.trim() || null,
    );
  return { ok: true };
}

export async function listAvancesForCamp(
  ctx: CampContext,
  campId: string,
): Promise<CampAvances | null> {
  await ensureAvancesSchema();
  const camp = await getCamp(ctx, campId);
  if (!camp) return null;
  const rows = await getDb()
    .prepare(
      `SELECT a.*, e.description AS ecriture_description,
              e.date_ecriture AS ecriture_date, e.activite_id AS ecriture_activite_id
       FROM avances_camp a
       LEFT JOIN ecritures e ON e.id = a.ecriture_id
       WHERE a.group_id = ? AND a.camp_id = ?
       ORDER BY COALESCE(a.date_versement, a.created_at) DESC, a.id DESC`,
    )
    .all<AvanceCamp>(ctx.groupId, campId);
  const avances = rows.map((a) => ({
    ...a,
    double_comptage:
      a.ecriture_activite_id != null &&
      a.ecriture_activite_id === camp.activite_id,
  }));
  return { avances, summary: buildAvancesSummary(avances) };
}

async function getAvance(
  ctx: CampContext,
  id: string,
): Promise<AvanceCamp | null> {
  await ensureAvancesSchema();
  const avance = await getDb()
    .prepare('SELECT * FROM avances_camp WHERE id = ? AND group_id = ?')
    .get<AvanceCamp>(id, ctx.groupId);
  if (!avance) return null;
  // Scope chef (lecture) : porté par le camp.
  const camp = await getCamp(ctx, avance.camp_id);
  if (!camp) return null;
  return avance;
}

export async function cloturerAvance(
  ctx: CampContext,
  id: string,
  montantRenduCents: number,
): Promise<{ ok: boolean; error?: string; campId?: string }> {
  const avance = await getAvance(ctx, id);
  if (!avance) return { ok: false, error: 'Avance introuvable.' };
  if (avance.statut !== 'versee') {
    return { ok: false, error: 'Avance déjà clôturée.', campId: avance.camp_id };
  }
  const err = validateCloture(avance.montant_cents, montantRenduCents);
  if (err) return { ok: false, error: err, campId: avance.camp_id };
  await getDb()
    .prepare(
      `UPDATE avances_camp SET statut = 'cloturee', montant_rendu_cents = ?, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(montantRenduCents, currentTimestamp(), id, ctx.groupId);
  return { ok: true, campId: avance.camp_id };
}

// Correction d'erreur : rouvrir une avance clôturée par mégarde. Le rendu
// est remis à null (il sera ressaisi à la vraie clôture).
export async function rouvrirAvance(
  ctx: CampContext,
  id: string,
): Promise<{ ok: boolean; error?: string; campId?: string }> {
  const avance = await getAvance(ctx, id);
  if (!avance) return { ok: false, error: 'Avance introuvable.' };
  if (avance.statut !== 'cloturee') {
    return { ok: false, error: 'Avance non clôturée.', campId: avance.camp_id };
  }
  await getDb()
    .prepare(
      `UPDATE avances_camp SET statut = 'versee', montant_rendu_cents = NULL, updated_at = ?
       WHERE id = ? AND group_id = ?`,
    )
    .run(currentTimestamp(), id, ctx.groupId);
  return { ok: true, campId: avance.camp_id };
}

// Écritures candidates au lien « virement de l'avance » (traçabilité) :
// dernières dépenses du groupe, pour le select du formulaire admin.
export interface EcritureCandidate {
  id: string;
  date_ecriture: string;
  description: string;
  amount_cents: number;
}

export async function listEcrituresCandidatesAvance(
  ctx: CampContext,
): Promise<EcritureCandidate[]> {
  return await getDb()
    .prepare(
      `SELECT e.id, e.date_ecriture, e.description, e.amount_cents
       FROM ecritures e
       WHERE e.group_id = ? AND e.type = 'depense'
       ORDER BY e.date_ecriture DESC, e.id DESC
       LIMIT 30`,
    )
    .all<EcritureCandidate>(ctx.groupId);
}
```

> Vérifier avant d'écrire : la signature réelle de `nextIdOn` dans `web/src/lib/ids.ts` (`nextIdOn(db, prefix, { tables })` — utilisée par `camps.ts` ligne 67) ; les colonnes réelles d'`ecritures` utilisées (`date_ecriture`, `description`, `amount_cents`, `activite_id`, `type`) — déjà utilisées telles quelles par `camps.ts`. Adapter si besoin.

- [ ] **Step 2 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/lib/services/camp-avances.ts`
- [ ] **Step 3 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/services/camp-avances.ts
git commit -m "feat(camps): service avances de trésorerie — schema lazy, create/cloture/rouvrir"
```

---

### Task 3 : Actions `createAvanceCamp` / `cloturerAvanceCamp` / `rouvrirAvanceCamp`

**Files:** Modify `web/src/lib/actions/camps.ts`

- [ ] **Step 1 : Ajouter les actions** — dans `actions/camps.ts` (déjà `'use server'`), ajouter les imports puis les 3 actions en fin de fichier. Montant parsé avec `parseAmount` de `../format` (format français `"42,50"` → cents ; throw sur saisie illisible → try/catch). FK `ecriture_id` : `|| null` (jamais `""`) :

```ts
import { parseAmount } from '../format';
import {
  createAvance,
  cloturerAvance,
  rouvrirAvance,
  AVANCE_MODES,
  type AvanceMode,
} from '../services/camp-avances';
```

```ts
export async function createAvanceCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const campId = (formData.get('camp_id') as string | null) ?? '';
  if (!isAdmin(ctx.role)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const beneficiaire = (formData.get('beneficiaire') as string | null)?.trim() ?? '';
  const montantRaw = (formData.get('montant') as string | null)?.trim() ?? '';
  const mode = (formData.get('mode') as string | null) ?? '';
  if (!campId || !beneficiaire || !montantRaw || !(AVANCE_MODES as readonly string[]).includes(mode)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Bénéficiaire, montant et mode requis.'));
  }
  let montant_cents: number;
  try {
    montant_cents = parseAmount(montantRaw);
  } catch {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Montant illisible (format attendu : 150,00).'));
  }
  const res = await createAvance(
    { groupId: ctx.groupId },
    {
      camp_id: campId,
      beneficiaire,
      montant_cents: montant_cents!,
      date_versement: (formData.get('date_versement') as string | null) || null,
      mode: mode as AvanceMode,
      ecriture_id: (formData.get('ecriture_id') as string | null) || null,
      notes: (formData.get('notes') as string | null) || null,
    },
  );
  if (!res.ok) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent(res.error ?? 'Création refusée.'));
  }
  revalidatePath(`/camps/${campId}`);
  redirect(`/camps/${campId}`);
}

export async function cloturerAvanceCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const campId = (formData.get('camp_id') as string | null) ?? '';
  if (!isAdmin(ctx.role)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = (formData.get('id') as string | null) ?? '';
  const renduRaw = (formData.get('montant_rendu') as string | null)?.trim() ?? '';
  let rendu_cents: number;
  try {
    rendu_cents = parseAmount(renduRaw === '' ? '0' : renduRaw);
  } catch {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Montant rendu illisible (format attendu : 12,50).'));
  }
  const res = await cloturerAvance({ groupId: ctx.groupId }, id, rendu_cents!);
  if (!res.ok) {
    redirect(`/camps/${res.campId ?? campId}?error=` + encodeURIComponent(res.error ?? 'Clôture refusée.'));
  }
  revalidatePath(`/camps/${campId}`);
  redirect(`/camps/${campId}`);
}

export async function rouvrirAvanceCamp(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  const campId = (formData.get('camp_id') as string | null) ?? '';
  if (!isAdmin(ctx.role)) {
    redirect(`/camps/${campId}?error=` + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }
  const id = (formData.get('id') as string | null) ?? '';
  const res = await rouvrirAvance({ groupId: ctx.groupId }, id);
  if (!res.ok) {
    redirect(`/camps/${res.campId ?? campId}?error=` + encodeURIComponent(res.error ?? 'Réouverture refusée.'));
  }
  revalidatePath(`/camps/${campId}`);
  redirect(`/camps/${campId}`);
}
```

- [ ] **Step 2 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint src/lib/actions/camps.ts`
- [ ] **Step 3 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add web/src/lib/actions/camps.ts
git commit -m "feat(camps): actions avances — versement, clôture avec reliquat, réouverture"
```

---

### Task 4 : Section « Avances de trésorerie » sur `/camps/[id]`

**Files:** Modify `web/src/app/(app)/camps/[id]/page.tsx`

- [ ] **Step 1 : Charger les données** — LIRE la page d'abord. Dans le composant `CampDetailPage`, après `getCampDashboard` (qui valide déjà le scope), charger :

```ts
import { listAvancesForCamp, listEcrituresCandidatesAvance, type AvanceCamp, type EcritureCandidate } from '@/lib/services/camp-avances';
import { createAvanceCamp, cloturerAvanceCamp, rouvrirAvanceCamp } from '@/lib/actions/camps';
import { formatAmount } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { ChevronDown, Plus } from 'lucide-react';
```

```ts
  const campCtx = { groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId };
  const [avancesData, candidates] = await Promise.all([
    listAvancesForCamp(campCtx, id),
    isAdmin ? listEcrituresCandidatesAvance(campCtx) : Promise.resolve([]),
  ]);
  const avances = avancesData?.avances ?? [];
  const avSummary = avancesData?.summary ?? null;
```

- [ ] **Step 2 : Section UI** — insérer la section entre « Recettes » et « Justificatifs manquants ». Visible si `isAdmin || avances.length > 0` (un chef sans avance ne voit rien). Contenu :

```tsx
        {(isAdmin || avances.length > 0) && (
          <Section title="Avances de trésorerie">
            {avSummary && avances.length > 0 && (
              <p className="mb-3 text-[12.5px] text-fg-muted">
                <Amount cents={avSummary.enCirculationCents} /> en circulation
                ({avSummary.enCoursCount} avance{avSummary.enCoursCount > 1 ? 's' : ''} en cours)
                {avSummary.consommeCents > 0 && (
                  <> · <Amount cents={avSummary.consommeCents} /> consommés sur les avances clôturées</>
                )}
              </p>
            )}

            {avances.length === 0 ? (
              <p className="text-[13px] text-fg-muted">
                Aucune avance versée pour ce camp. Une avance est un transfert
                au chef — ce sont ses tickets qui comptent dans le budget.
              </p>
            ) : (
              <ul className="divide-y divide-border-soft rounded-lg border border-border-soft overflow-hidden">
                {avances.map((a) => (
                  <AvanceRow key={a.id} avance={a} campId={camp.id} isAdmin={isAdmin} />
                ))}
              </ul>
            )}

            {isAdmin && (
              <details className="group/avance mt-3 rounded-lg border border-border-soft overflow-hidden">
                <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium text-fg transition-colors hover:bg-bg-sunken/40">
                  <Plus size={14} strokeWidth={2.25} className="text-brand" />
                  Nouvelle avance
                  <ChevronDown
                    size={14}
                    strokeWidth={2.25}
                    className="ml-auto text-fg-subtle transition-transform group-open/avance:rotate-180"
                  />
                </summary>
                <CreateAvanceForm campId={camp.id} candidates={candidates} />
              </details>
            )}
          </Section>
        )}
```

- [ ] **Step 3 : Composants locaux** — en bas du fichier (pattern `PosteRow`), ajouter :

```tsx
const AVANCE_MODE_LABEL: Record<string, string> = {
  virement: 'virement',
  especes: 'espèces',
};

function AvanceRow({
  avance,
  campId,
  isAdmin,
}: {
  avance: AvanceCamp;
  campId: string;
  isAdmin: boolean;
}) {
  const cloturee = avance.statut === 'cloturee';
  return (
    <li className="px-3 py-2.5 text-[13px] space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium shrink-0 ${
            cloturee
              ? 'bg-bg-sunken text-fg-muted'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          {cloturee ? 'Clôturée' : 'En circulation'}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-fg">
          {avance.beneficiaire}
          <span className="font-normal text-fg-subtle">
            {' '}· {AVANCE_MODE_LABEL[avance.mode] ?? avance.mode}
            {avance.date_versement && <> · {avance.date_versement}</>}
          </span>
        </span>
        <span className="tabular-nums shrink-0">
          <Amount cents={avance.montant_cents} />
        </span>
      </div>

      {cloturee && (
        <p className="text-[11.5px] text-fg-subtle">
          rendu <Amount cents={avance.montant_rendu_cents ?? 0} /> · consommé{' '}
          <Amount cents={avance.montant_cents - (avance.montant_rendu_cents ?? 0)} />
        </p>
      )}

      {avance.ecriture_id && (
        <p className="text-[11.5px] text-fg-subtle">
          virement :{' '}
          <Link
            href={`/ecritures/${avance.ecriture_id}`}
            className="underline underline-offset-2"
          >
            {avance.ecriture_date} — {avance.ecriture_description}
          </Link>
        </p>
      )}

      {avance.double_comptage && (
        <Alert variant="error" className="text-[12px]">
          L’écriture du virement est imputée à l’activité du camp : elle compte
          en double avec les tickets du chef. Retirer l’activité de cette
          écriture (une avance est un transfert, pas une dépense du camp).
        </Alert>
      )}

      {isAdmin && !cloturee && (
        <form
          action={cloturerAvanceCamp}
          className="flex flex-wrap items-center gap-2 pt-1"
        >
          <input type="hidden" name="id" value={avance.id} />
          <input type="hidden" name="camp_id" value={campId} />
          <Input
            name="montant_rendu"
            inputMode="decimal"
            placeholder="reliquat rendu, ex. 12,50"
            className="h-8 w-44 text-[12.5px]"
          />
          <PendingButton variant="outline" size="sm">
            Clôturer l’avance
          </PendingButton>
        </form>
      )}

      {isAdmin && cloturee && (
        <form action={rouvrirAvanceCamp} className="pt-1">
          <input type="hidden" name="id" value={avance.id} />
          <input type="hidden" name="camp_id" value={campId} />
          <PendingButton variant="ghost" size="sm">
            Rouvrir
          </PendingButton>
        </form>
      )}
    </li>
  );
}

function CreateAvanceForm({
  campId,
  candidates,
}: {
  campId: string;
  candidates: EcritureCandidate[];
}) {
  return (
    <form
      action={createAvanceCamp}
      className="border-t border-border-soft p-3 space-y-3"
    >
      <input type="hidden" name="camp_id" value={campId} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Bénéficiaire (chef)" htmlFor="beneficiaire" required>
          <Input id="beneficiaire" name="beneficiaire" required placeholder="Prénom Nom" />
        </Field>
        <Field label="Montant" htmlFor="montant" required>
          <Input
            id="montant"
            name="montant"
            required
            inputMode="decimal"
            placeholder="300,00"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date de versement" htmlFor="date_versement">
          <Input id="date_versement" name="date_versement" type="date" />
        </Field>
        <Field label="Mode" htmlFor="mode" required>
          <NativeSelect id="mode" name="mode" required defaultValue="virement">
            <option value="virement">Virement</option>
            <option value="especes">Espèces</option>
          </NativeSelect>
        </Field>
      </div>
      <Field
        label="Écriture du virement"
        htmlFor="ecriture_id"
        hint="optionnel — traçabilité ; NE PAS imputer cette écriture à l’activité du camp"
      >
        <NativeSelect id="ecriture_id" name="ecriture_id" defaultValue="">
          <option value="">— Aucune —</option>
          {candidates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.date_ecriture} — {e.description} — {formatAmount(e.amount_cents)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Notes" htmlFor="avance_notes" hint="optionnel">
        <Textarea id="avance_notes" name="notes" rows={2} />
      </Field>
      <div className="flex justify-end">
        <PendingButton size="sm">Verser l’avance</PendingButton>
      </div>
    </form>
  );
}
```

> Vérifier : la signature de `formatAmount` (`lib/format.ts:9`, `formatAmount(cents)` → string) ; que `/ecritures/[id]` existe bien comme route (déjà utilisée par le bloc « Justificatifs manquants » de cette même page — sinon reprendre le même pattern de lien que ce bloc) ; les variants disponibles de `PendingButton`/`Button` (`outline`, `ghost`, `sm` — cf. usages existants dans la page). Adapter si besoin.

- [ ] **Step 4 : Vérifier** — `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint "src/app/(app)/camps/[id]/page.tsx"`
- [ ] **Step 5 : Commit**
```bash
cd "$(git rev-parse --show-toplevel)"
git add "web/src/app/(app)/camps/[id]/page.tsx"
git commit -m "feat(camps): section avances de trésorerie sur la page camp"
```

---

### Task 5 : Vérification finale

- [ ] **Step 1 :** `cd web && ./node_modules/.bin/tsc --noEmit -p tsconfig.json && ./node_modules/.bin/eslint . && ./node_modules/.bin/vitest run` → tsc clean, lint clean, tous tests verts (dont les 9 de camp-avances-logic).
- [ ] **Step 2 : Contrôle visuel** (trésorier) : sur un camp existant, créer une avance (bénéficiaire + 300,00 + virement) → elle apparaît « En circulation », le résumé affiche 300,00 € en circulation, le budget du camp NE bouge PAS ; lier une écriture du virement → le lien s'affiche ; imputer cette écriture à l'activité du camp depuis /ecritures → l'alerte rouge double comptage apparaît sur la page camp ; clôturer avec 12,50 de reliquat → statut Clôturée, « rendu 12,50 · consommé 287,50 » ; rouvrir → retour En circulation, rendu effacé ; vérifier en tant que chef : section visible en lecture seule (pas de forms), invisible si aucune avance.

---

## Self-review (auteur du plan)

- **Couverture spec A2** : table `avances_camp` conforme au DDL spec (mêmes colonnes) ✓ ; versement (T2/T3/T4) ✓ ; clôture avec reliquat (`montant_rendu_cents`, validation 0 ≤ rendu ≤ montant) ✓ ; garde-fou double comptage (flag SQL+TS, alerte rouge sur la page) ✓ ; « suivi des justifs sur l'avance » = les tickets passent par le flux dépôts existant (A1) — pas de lien ticket↔avance en V1, le suivi par chef se fait visuellement (assumé : la table spec n'a aucun champ pour ça) ; avances ≠ dépenses : aucune requête du dashboard budget ne touche `avances_camp` ✓.
- **Placeholder scan** : code complet pour module/service/actions/UI ; 2 blocs « Vérifier » explicites (signature nextIdOn, formatAmount/route écritures/variants boutons) — ce sont des vérifications, pas des trous.
- **Type consistency** : `AvanceLike`/`AvancesSummary`/`validateCloture`/`buildAvancesSummary` (T1) utilisés T2 ✓ ; `createAvance`/`cloturerAvance`/`rouvrirAvance`/`AVANCE_MODES`/`AvanceCamp`/`EcritureCandidate` (T2) utilisés T3/T4 ✓ ; `createAvanceCamp`/`cloturerAvanceCamp`/`rouvrirAvanceCamp` (T3) utilisés T4 ✓ ; noms de champs form (`beneficiaire`, `montant`, `date_versement`, `mode`, `ecriture_id`, `notes`, `montant_rendu`, `camp_id`, `id`) alignés actions ↔ UI ✓.
- **Règles projet** : pas de DELETE (rouvrir au lieu de supprimer) ; pas de CHECK SQL ; `nextIdOn` avec `tables: ['avances_camp']` (piège #11) ; FK `ecriture_id` via `|| null` ; `ensureCampsSchema()` avant le CREATE de la FK camps ; admin re-vérifié dans chaque action ; chef = lecture seule scopée via `getCamp`.
