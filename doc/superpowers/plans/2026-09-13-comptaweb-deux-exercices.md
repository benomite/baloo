# Comptaweb : deux exercices en parallèle — plan d'implémentation

> **Pour les agents :** SOUS-SKILL REQUIS — utiliser superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans pour exécuter ce plan tâche par tâche. Les étapes sont des cases à cocher (`- [ ]`).

**Goal :** permettre à Baloo de lire et d'écrire dans deux exercices Comptaweb en même temps pendant la période de clôture (septembre → déclaration de clôture), au lieu d'être coincé sur un seul.

**Architecture :** une connexion CW en cache par exercice (basculée puis confirmée à l'ouverture) ; un module pur qui calcule les exercices actifs (celui du jour + le précédent tant qu'il n'est pas déclaré clos) ; `runSyncCycle` boucle sur ces exercices ; la création d'écriture choisit la connexion d'après la date de l'écriture.

**Tech Stack :** Next 16 (App Router), TypeScript, libsql/Turso, cheerio (scraping HTML), vitest.

**Spec :** [`doc/superpowers/specs/2026-09-13-comptaweb-deux-exercices-design.md`](../specs/2026-09-13-comptaweb-deux-exercices-design.md) — ADR-039 dans `doc/decisions.md`.

## Global Constraints

- **Lancer les tests avec `npx vitest run …` depuis `web/`.** `pnpm test` échoue ici (`ERROR packages field missing or empty`).
- **Jamais de `DELETE`** sur les tables de données utilisateur ; toujours UPSERT (cf. `CLAUDE.md`). Ce chantier n'en a aucun besoin.
- **Migrations de colonnes** : colonne nullable via `ALTER TABLE` dans `web/src/lib/auth/schema.ts` (jamais `NOT NULL DEFAULT`, piège Turso), définition complète dans `business-schema.ts` pour les BDD vierges, `CREATE INDEX` éventuel après l'`ALTER`.
- **Commits** : messages en français, au présent, atomiques. Terminer chaque message par :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AVEEtXnBLspiVwMzzhPbZk
  ```
- **Jamais de `git push`** sans accord explicite de l'utilisateur (Vercel déploie automatiquement).
- **Parité MCP ↔ app** (ADR-038) : toute opération métier nouvelle exposée dans l'app l'est aussi en MCP, via le même service.
- **Format des codes d'exercice** : `YYYY-YYYY` (ex. `2025-2026`), exercice du 01/09/N au 31/08/N+1.
- Commentaires de code en français, comme le reste du dépôt.

---

### Task 1 : Module pur « exercices actifs »

**Files:**
- Create: `web/src/lib/services/exercices-actifs.ts`
- Test: `web/src/lib/services/__tests__/exercices-actifs.test.ts`

**Interfaces:**
- Consomme : `currentExercice`, `exerciceBounds` de `web/src/lib/services/overview.ts` (déjà existants : `currentExercice(now: Date): string` → `'2025-2026'`, `exerciceBounds(code): { start: string; end: string }`).
- Produit :
  - `interface ExerciceCw { cwId: number; libelle: string }`
  - `interface ExerciceActif { code: string; cwId: number; debut: string; fin: string }`
  - `codeFromLibelle(libelle: string): string | null`
  - `exercicesActifs(input: { exercicesCw: ExerciceCw[]; now?: Date; dernierExerciceClos?: string | null }): { actifs: ExerciceActif[]; avertissement: string | null }`
  - `exercicePourDate(actifs: ExerciceActif[], dateIso: string): ExerciceActif | null`

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, it, expect } from 'vitest';
import {
  codeFromLibelle,
  exercicesActifs,
  exercicePourDate,
  type ExerciceCw,
} from '../exercices-actifs';

const LISTE: ExerciceCw[] = [
  { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
  { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
  { cwId: 32, libelle: 'Sept 2024 - Aout 2025' },
];

describe('codeFromLibelle', () => {
  it('lit les deux années du libellé CW', () => {
    expect(codeFromLibelle('Sept 2025 - Août 2026')).toBe('2025-2026');
  });

  it('tolère la casse et les accents absents (libellés anciens)', () => {
    expect(codeFromLibelle('sept 2016 - aout 2017')).toBe('2016-2017');
  });

  it('rend null sur un libellé inattendu', () => {
    expect(codeFromLibelle('Exercice en cours')).toBeNull();
  });
});

describe('exercicesActifs', () => {
  it('le 01/09 : le nouvel exercice et le précédent, le plus récent d’abord', () => {
    const { actifs, avertissement } = exercicesActifs({
      exercicesCw: LISTE,
      now: new Date('2026-09-01T10:00:00Z'),
      dernierExerciceClos: null,
    });
    expect(actifs.map((e) => e.code)).toEqual(['2026-2027', '2025-2026']);
    expect(actifs[0]).toEqual({ code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' });
    expect(avertissement).toBeNull();
  });

  it('le 31/08 : l’exercice en cours est encore celui qui se termine', () => {
    const { actifs } = exercicesActifs({
      exercicesCw: LISTE,
      now: new Date('2026-08-31T10:00:00Z'),
      dernierExerciceClos: null,
    });
    expect(actifs.map((e) => e.code)).toEqual(['2025-2026', '2024-2025']);
  });

  it('exercice précédent déclaré clos → un seul actif', () => {
    const { actifs } = exercicesActifs({
      exercicesCw: LISTE,
      now: new Date('2026-09-15T10:00:00Z'),
      dernierExerciceClos: '2025-2026',
    });
    expect(actifs.map((e) => e.code)).toEqual(['2026-2027']);
  });

  it('nouvel exercice pas encore créé dans CW → l’ancien seul, avec avertissement', () => {
    const { actifs, avertissement } = exercicesActifs({
      exercicesCw: [{ cwId: 33, libelle: 'Sept 2025 - Août 2026' }],
      now: new Date('2026-09-15T10:00:00Z'),
      dernierExerciceClos: null,
    });
    expect(actifs.map((e) => e.code)).toEqual(['2025-2026']);
    expect(avertissement).toContain('2026-2027');
  });
});

describe('exercicePourDate', () => {
  const { actifs } = exercicesActifs({
    exercicesCw: LISTE,
    now: new Date('2026-09-15T10:00:00Z'),
    dernierExerciceClos: null,
  });

  it('une dépense du 24/08/2026 appartient à 2025-2026', () => {
    expect(exercicePourDate(actifs, '2026-08-24')?.cwId).toBe(33);
  });

  it('une dépense du 05/09/2026 appartient à 2026-2027', () => {
    expect(exercicePourDate(actifs, '2026-09-05')?.cwId).toBe(34);
  });

  it('une date hors des exercices actifs (exercice clos) rend null', () => {
    expect(exercicePourDate(actifs, '2025-03-10')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run : `cd web && npx vitest run src/lib/services/__tests__/exercices-actifs.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "../exercices-actifs"`.

- [ ] **Step 3: Écrire l'implémentation minimale**

```ts
// Exercices SGDF actifs pour un groupe : module PUR (ni BDD ni HTTP).
//
// L'exercice court du 01/09 au 31/08 et, dans Comptaweb, c'est le contexte de
// la session — pas un filtre (cf. ADR-039). Pendant la clôture (septembre →
// déclaration de clôture), deux exercices vivent en parallèle : les dépenses
// de camp d'août se saisissent encore sur l'ancien pendant que la rentrée
// alimente le nouveau.
import { currentExercice, exerciceBounds } from './overview';

/** Une option du select de `/exercice?m=1` côté Comptaweb. */
export interface ExerciceCw {
  cwId: number;
  libelle: string;
}

/** Un exercice actif, prêt à être routé vers sa connexion CW. */
export interface ExerciceActif {
  code: string; // '2025-2026'
  cwId: number;
  debut: string; // ISO '2025-09-01'
  fin: string; // ISO '2026-08-31'
}

/** « Sept 2025 - Août 2026 » → '2025-2026'. Null si le libellé est inattendu. */
export function codeFromLibelle(libelle: string): string | null {
  const m = libelle.match(/(\d{4})\D+(\d{4})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function toActif(code: string, cwId: number): ExerciceActif {
  const { start, end } = exerciceBounds(code);
  return { code, cwId, debut: start, fin: end };
}

function codePrecedent(code: string): string {
  const debut = Number(code.slice(0, 4)) - 1;
  return `${debut}-${debut + 1}`;
}

/**
 * Exercices sur lesquels Baloo doit travailler : celui de la date du jour, plus
 * le précédent TANT QU'IL N'EST PAS déclaré clos (réglage groupe
 * `dernier_exercice_clos`). Le plus récent d'abord — c'est l'ordre de priorité
 * de la sync.
 */
export function exercicesActifs(input: {
  exercicesCw: ExerciceCw[];
  now?: Date;
  dernierExerciceClos?: string | null;
}): { actifs: ExerciceActif[]; avertissement: string | null } {
  const parCode = new Map<string, number>();
  for (const e of input.exercicesCw) {
    const code = codeFromLibelle(e.libelle);
    if (code) parCode.set(code, e.cwId);
  }

  const codeCourant = currentExercice(input.now ?? new Date());
  const codeAncien = codePrecedent(codeCourant);
  const clos = input.dernierExerciceClos ?? null;

  const actifs: ExerciceActif[] = [];
  let avertissement: string | null = null;

  const idCourant = parCode.get(codeCourant);
  if (idCourant !== undefined) {
    actifs.push(toActif(codeCourant, idCourant));
  } else {
    avertissement = `L'exercice ${codeCourant} n'existe pas encore dans Comptaweb.`;
  }

  // Comparaison de chaînes suffisante : 'YYYY-YYYY' s'ordonne comme les années.
  const ancienClos = clos !== null && clos >= codeAncien;
  const idAncien = parCode.get(codeAncien);
  if (!ancienClos && idAncien !== undefined) {
    actifs.push(toActif(codeAncien, idAncien));
  }

  return { actifs, avertissement };
}

/** L'exercice actif auquel appartient une date ISO, ou null (hors périmètre). */
export function exercicePourDate(actifs: ExerciceActif[], dateIso: string): ExerciceActif | null {
  return actifs.find((e) => dateIso >= e.debut && dateIso <= e.fin) ?? null;
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run : `cd web && npx vitest run src/lib/services/__tests__/exercices-actifs.test.ts`
Attendu : PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/services/exercices-actifs.ts web/src/lib/services/__tests__/exercices-actifs.test.ts
git commit -m "feat(exercices): module pur des exercices CW actifs"
```

---

### Task 2 : Lire et basculer l'exercice dans Comptaweb

**Files:**
- Create: `web/src/lib/comptaweb/exercices.ts`
- Test: `web/src/lib/comptaweb/__tests__/exercices.test.ts`
- Modify: `web/src/lib/comptaweb/index.ts` (exports)

**Interfaces:**
- Consomme : `ExerciceCw` (Task 1) ; `ComptawebConfig` (`web/src/lib/comptaweb/types.ts` : `{ baseUrl: string; cookie: string }`) ; `fetchHtml(config, path)` (`web/src/lib/comptaweb/http.ts`).
- Produit :
  - `interface PageExercices { contexteCwId: number; options: ExerciceCw[]; csrfToken: string; actionPath: string }`
  - `parseExercicesHtml(html: string): PageExercices`
  - `fetchExercices(config: ComptawebConfig): Promise<PageExercices>`
  - `assurerExercice(config: ComptawebConfig, cwId: number, deps?: ExercicesDeps): Promise<void>` — bascule si besoin puis **relit** pour confirmer ; throw sinon.
  - `interface ExercicesDeps { lirePage?: (config: ComptawebConfig) => Promise<PageExercices>; poster?: (config: ComptawebConfig, path: string, body: URLSearchParams) => Promise<void> }`

Structure HTML réelle (relevée le 2026-09-11 sur `GET /exercice?m=1`) : un `<form method="post" action="/exercice/upd?id=<exercice courant>">` contenant `<select name="exercice_change[identifiants_exercices]">` (une option par exercice, `value` = id CW) et `<input type="hidden" name="exercice_change[_token]">`. **L'id dans l'`action` est celui du contexte courant** : c'est ainsi qu'on lit l'exercice actif d'une session.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, it, expect, vi } from 'vitest';
import { parseExercicesHtml, assurerExercice, type PageExercices } from '../exercices';
import type { ComptawebConfig } from '../types';

const HTML = `
<html><body>
  <h3>CHANGEMENT DE L'EXERCICE DE TRAVAIL</h3>
  <form method="post" action="/exercice/upd?id=33">
    <select name="exercice_change[identifiants_exercices]">
      <option value="34">Sept 2026 - Août 2027</option>
      <option value="33" selected="selected">Sept 2025 - Août 2026</option>
      <option value="32">Sept 2024 - Aout 2025</option>
    </select>
    <input type="hidden" name="exercice_change[_token]" value="tok-abc" />
    <button type="submit" name="exercice_change[submit]">Prendre ce nouvel exercice</button>
  </form>
</body></html>`;

const CONFIG: ComptawebConfig = { baseUrl: 'https://comptaweb.sgdf.fr', cookie: 'PHPSESSID=x' };

describe('parseExercicesHtml', () => {
  it('lit le contexte courant dans l’action du formulaire', () => {
    expect(parseExercicesHtml(HTML).contexteCwId).toBe(33);
  });

  it('liste les exercices proposés', () => {
    expect(parseExercicesHtml(HTML).options).toEqual([
      { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
      { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
      { cwId: 32, libelle: 'Sept 2024 - Aout 2025' },
    ]);
  });

  it('lit le jeton CSRF', () => {
    expect(parseExercicesHtml(HTML).csrfToken).toBe('tok-abc');
  });

  it('échoue clairement si le formulaire a changé', () => {
    expect(() => parseExercicesHtml('<html><body>rien</body></html>')).toThrow(/exercice/i);
  });
});

describe('assurerExercice', () => {
  const page = (contexteCwId: number): PageExercices => ({
    contexteCwId,
    options: [
      { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
      { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
    ],
    csrfToken: 'tok-abc',
    actionPath: `/exercice/upd?id=${contexteCwId}`,
  });

  it('ne bascule pas quand la session est déjà sur le bon exercice', async () => {
    const poster = vi.fn();
    await assurerExercice(CONFIG, 33, { lirePage: async () => page(33), poster });
    expect(poster).not.toHaveBeenCalled();
  });

  it('bascule puis relit pour confirmer', async () => {
    const poster = vi.fn(async () => {});
    const lirePage = vi
      .fn<[], Promise<PageExercices>>()
      .mockResolvedValueOnce(page(33))
      .mockResolvedValueOnce(page(34));

    await assurerExercice(CONFIG, 34, { lirePage, poster });

    expect(poster).toHaveBeenCalledTimes(1);
    const [, path, body] = poster.mock.calls[0];
    expect(path).toBe('/exercice/upd?id=33');
    expect(body.get('exercice_change[identifiants_exercices]')).toBe('34');
    expect(body.get('exercice_change[_token]')).toBe('tok-abc');
    expect(lirePage).toHaveBeenCalledTimes(2);
  });

  it('throw si la relecture ne confirme pas la bascule', async () => {
    const lirePage = vi
      .fn<[], Promise<PageExercices>>()
      .mockResolvedValueOnce(page(33))
      .mockResolvedValueOnce(page(33));

    await expect(
      assurerExercice(CONFIG, 34, { lirePage, poster: async () => {} }),
    ).rejects.toThrow(/exercice 34/i);
  });

  it('throw si l’exercice demandé n’est pas proposé par CW', async () => {
    await expect(
      assurerExercice(CONFIG, 99, { lirePage: async () => page(33), poster: async () => {} }),
    ).rejects.toThrow(/99/);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run : `cd web && npx vitest run src/lib/comptaweb/__tests__/exercices.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "../exercices"`.

- [ ] **Step 3: Écrire l'implémentation minimale**

```ts
// Contexte d'exercice d'une session Comptaweb (ADR-039).
//
// CW n'expose pas l'exercice en paramètre d'URL : chaque session a le sien,
// changé par le formulaire de `/exercice?m=1`. L'attribut `action` de ce
// formulaire porte l'id de l'exercice COURANT — c'est notre seule façon de lire
// le contexte d'une session.
import * as cheerio from 'cheerio';
import { fetchHtml } from './http';
import type { ComptawebConfig } from './types';
import type { ExerciceCw } from '../services/exercices-actifs';

const PAGE_PATH = '/exercice?m=1';

export interface PageExercices {
  contexteCwId: number;
  options: ExerciceCw[];
  csrfToken: string;
  actionPath: string;
}

export interface ExercicesDeps {
  lirePage?: (config: ComptawebConfig) => Promise<PageExercices>;
  poster?: (config: ComptawebConfig, path: string, body: URLSearchParams) => Promise<void>;
}

export function parseExercicesHtml(html: string): PageExercices {
  const $ = cheerio.load(html);
  const form = $('form[action*="/exercice/upd"]').first();
  const actionPath = form.attr('action') ?? '';
  const idMatch = actionPath.match(/id=(\d+)/);
  const select = form.find('select[name="exercice_change[identifiants_exercices]"]').first();
  const csrfToken = form.find('input[name="exercice_change[_token]"]').attr('value');

  if (!idMatch || !select.length || !csrfToken) {
    throw new Error(
      "Formulaire d'exercice introuvable sur /exercice?m=1 — le layout Comptaweb a changé.",
    );
  }

  const options: ExerciceCw[] = select
    .find('option')
    .toArray()
    .map((el) => ({ cwId: Number($(el).attr('value')), libelle: $(el).text().trim() }))
    .filter((o) => Number.isFinite(o.cwId) && o.libelle.length > 0);

  return { contexteCwId: Number(idMatch[1]), options, csrfToken, actionPath };
}

export async function fetchExercices(config: ComptawebConfig): Promise<PageExercices> {
  return parseExercicesHtml(await fetchHtml(config, PAGE_PATH));
}

async function posterFormulaire(
  config: ComptawebConfig,
  path: string,
  body: URLSearchParams,
): Promise<void> {
  const res = await fetch(new URL(path, config.baseUrl), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: config.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'baloo-compta/0.1',
      Accept: 'text/html',
    },
    body: body.toString(),
  });
  if (res.status >= 400) {
    throw new Error(`Bascule d'exercice refusée par Comptaweb (HTTP ${res.status}).`);
  }
}

/**
 * Garantit que la session est sur l'exercice `cwId`. Bascule si nécessaire,
 * puis RELIT la page pour confirmer. Sans confirmation, on throw : mieux vaut
 * une sync en échec qu'une écriture créée dans le mauvais exercice.
 */
export async function assurerExercice(
  config: ComptawebConfig,
  cwId: number,
  deps: ExercicesDeps = {},
): Promise<void> {
  const lirePage = deps.lirePage ?? fetchExercices;
  const poster = deps.poster ?? posterFormulaire;

  const page = await lirePage(config);
  if (page.contexteCwId === cwId) return;
  if (!page.options.some((o) => o.cwId === cwId)) {
    throw new Error(`Comptaweb ne propose pas l'exercice ${cwId} pour ce compte.`);
  }

  const body = new URLSearchParams();
  body.set('exercice_change[identifiants_exercices]', String(cwId));
  body.set('exercice_change[_token]', page.csrfToken);
  body.set('exercice_change[submit]', '');
  await poster(config, page.actionPath, body);

  const apres = await lirePage(config);
  if (apres.contexteCwId !== cwId) {
    throw new Error(
      `Bascule non confirmée : Comptaweb est resté sur l'exercice ${apres.contexteCwId} au lieu de l'exercice ${cwId}.`,
    );
  }
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run : `cd web && npx vitest run src/lib/comptaweb/__tests__/exercices.test.ts`
Attendu : PASS (9 tests).

- [ ] **Step 5: Exporter depuis l'index du client**

Dans `web/src/lib/comptaweb/index.ts`, ajouter après la ligne `export { fetchHtml, ComptawebSessionExpiredError } from './http';` :

```ts
export { fetchExercices, parseExercicesHtml, assurerExercice } from './exercices';
export type { PageExercices, ExercicesDeps } from './exercices';
```

- [ ] **Step 5bis: Vérifier les types**

Run : `cd web && npx tsc --noEmit -p .`
Attendu : aucune sortie.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/comptaweb/exercices.ts web/src/lib/comptaweb/__tests__/exercices.test.ts web/src/lib/comptaweb/index.ts
git commit -m "feat(comptaweb): lit et bascule l'exercice de la session"
```

---

### Task 3 : Une connexion CW en cache par exercice

**Files:**
- Modify: `web/src/lib/comptaweb/session-store.ts` (clé par exercice)
- Modify: `web/src/lib/comptaweb/auth.ts` (`withComptaweb`)
- Test: `web/src/lib/comptaweb/__tests__/session-store-par-exercice.test.ts`

**Interfaces:**
- Consomme : `assurerExercice` (Task 2).
- Produit :
  - `readStoredSession(cle: string)`, `writeStoredSession(cle: string, session: StoredSession)`, `clearStoredSession(cle: string)` — `cle` = id CW de l'exercice, ou `'default'`.
  - `loadConfigPourExercice(cwId: number): Promise<ComptawebConfig>`
  - `withComptaweb<T>(cwId: number, fn: (config: ComptawebConfig) => Promise<T>): Promise<T>`
  - `withAutoReLogin` et `loadConfig` restent exportés, inchangés en signature (clé `'default'`), pour les appelants non concernés (référentiels, cartes, caisse).

- [ ] **Step 1: Écrire le test qui échoue (isolation des caches)**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredSession, writeStoredSession, clearStoredSession } from '../session-store';

describe('session-store par exercice', () => {
  beforeEach(() => {
    clearStoredSession('33');
    clearStoredSession('34');
  });

  it('deux exercices ont des sessions indépendantes', () => {
    writeStoredSession('33', { cookieHeader: 'PHPSESSID=ancien', capturedAt: new Date().toISOString() });
    writeStoredSession('34', { cookieHeader: 'PHPSESSID=nouveau', capturedAt: new Date().toISOString() });

    expect(readStoredSession('33')?.cookieHeader).toBe('PHPSESSID=ancien');
    expect(readStoredSession('34')?.cookieHeader).toBe('PHPSESSID=nouveau');
  });

  it('vider la session d’un exercice ne touche pas l’autre', () => {
    writeStoredSession('33', { cookieHeader: 'PHPSESSID=ancien', capturedAt: new Date().toISOString() });
    writeStoredSession('34', { cookieHeader: 'PHPSESSID=nouveau', capturedAt: new Date().toISOString() });

    clearStoredSession('34');

    expect(readStoredSession('33')?.cookieHeader).toBe('PHPSESSID=ancien');
    expect(readStoredSession('34')).toBeNull();
  });

  it('une session périmée (plus de 8 h) n’est pas rendue', () => {
    const vieux = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString();
    writeStoredSession('33', { cookieHeader: 'PHPSESSID=vieux', capturedAt: vieux });
    expect(readStoredSession('33')).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run : `cd web && npx vitest run src/lib/comptaweb/__tests__/session-store-par-exercice.test.ts`
Attendu : ÉCHEC — TypeScript/vitest signale que `readStoredSession` ne prend pas d'argument (les deux exercices lisent le même fichier).

- [ ] **Step 3: Implémenter la clé dans `session-store.ts`**

Remplacer la constante `SESSION_FILE` et les trois fonctions par :

```ts
// Un fichier par clé de session. La clé est l'id CW de l'exercice (ADR-039) :
// une session Comptaweb ne voit qu'un exercice, donc deux exercices = deux
// cookies distincts. `default` sert aux appels non liés à un exercice précis.
function sessionFile(cle: string): string {
  const sain = cle.replace(/[^A-Za-z0-9_-]/g, '_');
  return resolve(DATA_DIR, `comptaweb-session-${sain}.json`);
}

export function readStoredSession(cle: string): StoredSession | null {
  const file = sessionFile(cle);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as StoredSession;
    if (!parsed.cookieHeader || !parsed.capturedAt) return null;
    const age = Date.now() - new Date(parsed.capturedAt).getTime();
    if (Number.isNaN(age) || age > DEFAULT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSession(cle: string, session: StoredSession): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(sessionFile(cle), JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearStoredSession(cle: string): void {
  const file = sessionFile(cle);
  if (!existsSync(file)) return;
  try {
    writeFileSync(file, JSON.stringify({ cookieHeader: '', capturedAt: '' }, null, 2), { mode: 0o600 });
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run : `cd web && npx vitest run src/lib/comptaweb/__tests__/session-store-par-exercice.test.ts`
Attendu : PASS (3 tests).

- [ ] **Step 5: Adapter `auth.ts` et ajouter `withComptaweb`**

Dans `web/src/lib/comptaweb/auth.ts` : passer la clé `'default'` aux trois appels existants (`readStoredSession('default')`, `writeStoredSession('default', …)`, `clearStoredSession('default')` dans `withAutoReLogin`), extraire l'ouverture de session, puis ajouter :

```ts
import { assurerExercice } from './exercices';

/** Ouvre (ou réutilise) la session dédiée à un exercice CW. */
export async function loadConfigPourExercice(cwId: number): Promise<ComptawebConfig> {
  const cle = String(cwId);
  const stored = readStoredSession(cle);
  const envBaseUrl = process.env.COMPTAWEB_BASE_URL ?? DEFAULT_BASE_URL;
  if (stored) return { baseUrl: envBaseUrl, cookie: stored.cookieHeader };

  const creds = await resolveComptawebCredentials();
  if (!creds) {
    throw new Error(
      'Aucun identifiant Comptaweb. Configure-les dans /admin/parametres (ou COMPTAWEB_USERNAME + COMPTAWEB_PASSWORD).',
    );
  }
  const baseUrl = creds.baseUrl ?? DEFAULT_BASE_URL;
  const result = await performAutomatedLogin(creds.username, creds.password, { baseUrl });
  const config = { baseUrl, cookie: result.cookieHeader };

  // Un login frais tombe sur l'exercice non clôturé : on bascule, puis on
  // confirme AVANT de mettre la session en cache. Une session en cache est donc
  // toujours une session dont l'exercice est prouvé.
  await assurerExercice(config, cwId);
  writeStoredSession(cle, {
    cookieHeader: result.cookieHeader,
    capturedAt: result.capturedAt,
    username: creds.username,
  });
  return config;
}

/** `withAutoReLogin`, mais sur la session d'un exercice donné. */
export async function withComptaweb<T>(
  cwId: number,
  fn: (config: ComptawebConfig) => Promise<T>,
): Promise<T> {
  const config = await loadConfigPourExercice(cwId);
  try {
    return await fn(config);
  } catch (err) {
    if (!(err instanceof ComptawebSessionExpiredError)) throw err;
    clearStoredSession(String(cwId));
    return fn(await loadConfigPourExercice(cwId));
  }
}
```

Exporter `withComptaweb` et `loadConfigPourExercice` depuis `web/src/lib/comptaweb/index.ts` (ligne `export { loadConfig, withAutoReLogin } from './auth';`).

- [ ] **Step 6: Vérifier la suite complète et les types**

Run : `cd web && npx vitest run && npx tsc --noEmit -p .`
Attendu : tous les tests passent, aucune erreur de type. (Les appels existants de `readStoredSession()` sans argument doivent tous avoir été corrigés — `tsc` les liste.)

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/comptaweb/session-store.ts web/src/lib/comptaweb/auth.ts web/src/lib/comptaweb/index.ts web/src/lib/comptaweb/__tests__/session-store-par-exercice.test.ts
git commit -m "feat(comptaweb): une session en cache par exercice"
```

---

### Task 4 : Réglage « dernier exercice clos »

**Files:**
- Modify: `web/src/lib/db/business-schema.ts` (table `groupes`), `web/src/lib/auth/schema.ts` (migration), `web/src/lib/services/groupes.ts` (type + patch), `web/src/lib/actions/parametres.ts` (action), `web/src/app/(app)/admin/parametres/page.tsx` (formulaire), `web/src/lib/mcp/tools/groupes.ts` (parité MCP)
- Test: `web/src/lib/services/__tests__/groupes-exercice-clos.test.ts`

**Interfaces:**
- Produit : colonne `groupes.dernier_exercice_clos` (TEXT nullable, ex. `2025-2026`) ; `UpdateGroupeInput.dernier_exercice_clos?: string | null` ; server action `updateExerciceClos(formData)` ; paramètre MCP `dernier_exercice_clos` sur `update_groupe`.
- Consommé par : Task 5 et Task 6 (via `getGroupe`).

- [ ] **Step 1: Écrire le test qui échoue**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@libsql/client';
import { wrapClient } from '../../db';

// Le service `groupes` tape `getDb()` : on valide ici la forme du patch et la
// migration, sur une BDD in-memory pilotée à la main.
describe('dernier_exercice_clos', () => {
  it('la migration ajoute une colonne nullable, sans valeur par défaut', async () => {
    const db = wrapClient(createClient({ url: 'file::memory:' }));
    await db.exec(`CREATE TABLE groupes (id TEXT PRIMARY KEY, code TEXT, nom TEXT)`);
    await db.exec(`INSERT INTO groupes (id, code, nom) VALUES ('g1', 'VDS', 'Val de Saône')`);

    await db.exec('ALTER TABLE groupes ADD COLUMN dernier_exercice_clos TEXT');

    const row = await db
      .prepare('SELECT dernier_exercice_clos FROM groupes WHERE id = ?')
      .get<{ dernier_exercice_clos: string | null }>('g1');
    expect(row?.dernier_exercice_clos).toBeNull();

    await db.exec(`UPDATE groupes SET dernier_exercice_clos = '2025-2026' WHERE id = 'g1'`);
    const apres = await db
      .prepare('SELECT dernier_exercice_clos FROM groupes WHERE id = ?')
      .get<{ dernier_exercice_clos: string | null }>('g1');
    expect(apres?.dernier_exercice_clos).toBe('2025-2026');
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run : `cd web && npx vitest run src/lib/services/__tests__/groupes-exercice-clos.test.ts`
Attendu : PASS immédiat (SQL pur). ⚠️ **Ce test ne protège que la forme de la migration** : le vrai filet est le test de Task 5 (`exercice clos → un seul exercice synchronisé`). Ne pas s'arrêter ici.

- [ ] **Step 3: Ajouter la colonne au schéma et la migration**

`business-schema.ts`, table `groupes` — après `taux_km_millicents` s'il est déclaré là, sinon après `notes` :

```sql
      dernier_exercice_clos TEXT,
```

`auth/schema.ts`, juste après le bloc `taux_km_millicents` (la variable `groupeCols` existe déjà) :

```ts
  if (!groupeCols.some((c) => c.name === 'dernier_exercice_clos')) {
    // Nullable, sans backfill : aucun exercice n'est déclaré clos au départ.
    await db.exec('ALTER TABLE groupes ADD COLUMN dernier_exercice_clos TEXT');
  }
```

- [ ] **Step 4: Threader le champ dans le service**

`services/groupes.ts` : ajouter `dernier_exercice_clos: string | null;` à `interface Groupe` et `dernier_exercice_clos?: string | null;` à `interface UpdateGroupeInput`. `updateGroupe` est générique (boucle sur les clés du patch) : rien d'autre à changer.

- [ ] **Step 5: Server action**

Ajouter à `web/src/lib/actions/parametres.ts` :

```ts
// Déclare (ou rouvre) la clôture d'un exercice. Format attendu : '2025-2026'.
// Vider le champ rouvre l'exercice — la déclaration est réversible.
export async function updateExerciceClos(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const raw = ((formData.get('dernier_exercice_clos') as string | null) ?? '').trim();
  if (raw && !/^\d{4}-\d{4}$/.test(raw)) {
    redirect('/admin/parametres?error=' + encodeURIComponent('Format attendu : 2025-2026.'));
  }

  try {
    await updateGroupe({ groupId: ctx.groupId }, { dernier_exercice_clos: raw || null });
  } catch (err) {
    logError('parametres', 'MAJ exercice clos échouée', err);
    redirect('/admin/parametres?error=' + encodeURIComponent('Échec de l’enregistrement.'));
  }
  revalidatePath('/admin/parametres');
  redirect('/admin/parametres?saved=1');
}
```

- [ ] **Step 6: Formulaire dans la page paramètres**

Dans `web/src/app/(app)/admin/parametres/page.tsx`, importer `updateExerciceClos` et ajouter une `<Section>` après celle des frais kilométriques :

```tsx
      <Section
        title="Exercice comptable"
        subtitle="Tant qu'un exercice n'est pas déclaré clos, Baloo continue d'y lire et d'y écrire."
      >
        <form action={updateExerciceClos} className="flex items-end gap-3">
          <Field label="Dernier exercice clos" htmlFor="dernier_exercice_clos">
            <Input
              id="dernier_exercice_clos"
              name="dernier_exercice_clos"
              inputMode="text"
              placeholder="2025-2026"
              defaultValue={groupe?.dernier_exercice_clos ?? ''}
              className="tabular-nums w-36"
            />
          </Field>
          <PendingButton pendingLabel="Enregistrement…">Enregistrer</PendingButton>
        </form>
      </Section>
```

Remplacer aussi le message de succès générique `Taux kilométrique enregistré.` par `Paramètres enregistrés.` (les deux formulaires partagent `?saved=1`).

- [ ] **Step 7: Parité MCP**

`web/src/lib/mcp/tools/groupes.ts` : ajouter au schéma zod de `update_groupe`

```ts
      dernier_exercice_clos: z
        .string()
        .regex(/^\d{4}-\d{4}$/)
        .nullable()
        .optional()
        .describe(
          "Dernier exercice comptable déclaré clos (ex: '2025-2026'). Baloo cesse alors d'y lire et d'y écrire. null rouvre l'exercice.",
        ),
```

et compléter la description du tool : `… IBAN principal, taux kilométrique, dernier exercice clos`. Le champ passe tel quel dans `patch` via le `...rest` existant.

- [ ] **Step 8: Vérifier**

Run : `cd web && npx vitest run && npx tsc --noEmit -p .`
Attendu : tout passe.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/db/business-schema.ts web/src/lib/auth/schema.ts web/src/lib/services/groupes.ts web/src/lib/actions/parametres.ts "web/src/app/(app)/admin/parametres/page.tsx" web/src/lib/mcp/tools/groupes.ts web/src/lib/services/__tests__/groupes-exercice-clos.test.ts
git commit -m "feat(parametres): déclarer un exercice comptable clos"
```

---

### Task 5 : La sync boucle sur les exercices actifs

**Files:**
- Modify: `web/src/lib/services/sync-cycle.ts`
- Modify: `web/src/lib/db/business-schema.ts` (colonne `sync_runs.exercices`)
- Test: `web/src/lib/services/__tests__/sync-cycle-deux-exercices.test.ts`

**Interfaces:**
- Consomme : `exercicesActifs`, `ExerciceActif` (Task 1) ; `loadConfigPourExercice` (Task 3) ; `getGroupe` (Task 4).
- Produit :
  - `SyncCycleOptions.exercices?: ExerciceActif[]` (injection tests ; sinon découverte réelle)
  - `SyncCycleOptions.loadConfigPourExercice?: (cwId: number) => Promise<ComptawebConfig>`
  - `SyncCycleResult.exercices: string[]` (codes couverts)
  - colonne `sync_runs.exercices` (TEXT nullable, codes joints par `,`)

Découpage : extraire le corps actuel des étapes 3 à 7f dans `async function syncUnExercice(db, groupId, exercice, ctx): Promise<Compteurs>`, où `ctx` porte la config de CET exercice, les resolvers, le budget restant de lectures détail et les warnings. `runSyncCycle` garde le throttle, le verrou, l'INSERT/UPDATE `sync_runs` et additionne les compteurs.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
// Reprendre le setup de `sync-cycle.test.ts` (setupDb, insertEcriture) : même
// BDD in-memory, mêmes injections. Ici on vérifie UNIQUEMENT le multi-exercice.
import { describe, it, expect } from 'vitest';
import { runSyncCycle } from '../sync-cycle';
import type { ExerciceActif } from '../exercices-actifs';
// setupDb / insertEcriture : copier les helpers de sync-cycle.test.ts.

const EX_2627: ExerciceActif = { code: '2026-2027', cwId: 34, debut: '2026-09-01', fin: '2027-08-31' };
const EX_2526: ExerciceActif = { code: '2025-2026', cwId: 33, debut: '2025-09-01', fin: '2026-08-31' };

const ligne = (cwId: number, date: string, montantCentimes: number) => ({
  id: cwId,
  numeroPiece: `ECR-${cwId}`,
  dateEcriture: date,
  type: 'depense' as const,
  intitule: `Ligne ${cwId}`,
  montantCentimes,
  compteBancaire: 'GROUPE VAL DE SAONE',
  modeTransaction: 'Carte',
  categorieTiers: '',
  structureTiers: '',
  rapproche: false,
});

describe('runSyncCycle — deux exercices', () => {
  it('lit les deux exercices en un seul run et importe des deux', async () => {
    const { db } = await setupDb();
    const vues: number[] = [];

    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => ({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
      scrapeListe: async (cfg) => {
        const cwId = Number(cfg.cookie.replace('c-', ''));
        vues.push(cwId);
        return {
          ecritures: cwId === 34 ? [ligne(900, '2026-09-05', 1000)] : [ligne(800, '2026-08-24', 2000)],
        };
      },
      scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
      scrapeDetail: async (cwId) => ({
        ventilations: [{ montantCents: cwId === 900 ? 1000 : 2000, nature: null, activite: null, brancheprojet: null }],
      }),
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(vues.sort()).toEqual([33, 34]);
    expect(res.status).toBe('ok');
    expect(res.imported_from_cw).toBe(2);
    expect(res.exercices).toEqual(['2026-2027', '2025-2026']);

    const row = await db
      .prepare('SELECT exercices FROM sync_runs WHERE id = ?')
      .get<{ exercices: string | null }>(res.sync_run_id);
    expect(row?.exercices).toBe('2026-2027,2025-2026');
  });

  it('un exercice en échec n’empêche pas l’autre', async () => {
    const { db } = await setupDb();

    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => {
        if (cwId === 33) throw new Error('Bascule non confirmée');
        return { baseUrl: 'https://cw.test', cookie: 'c-34' };
      },
      scrapeListe: async () => ({ ecritures: [ligne(900, '2026-09-05', 1000)] }),
      scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
      scrapeDetail: async () => ({ ventilations: [{ montantCents: 1000, nature: null, activite: null, brancheprojet: null }] }),
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(res.status).toBe('ok');
    expect(res.imported_from_cw).toBe(1); // 26/27 a bien abouti
    expect(res.error_message).toContain('2025-2026');
    expect(res.exercices).toEqual(['2026-2027']);
  });

  it('le budget de lectures détail est partagé, pas doublé', async () => {
    const { db } = await setupDb();
    let fetches = 0;

    const res = await runSyncCycle(db, 'g1', {
      trigger: 'manual',
      force: true,
      maxDetailFetches: 2,
      exercices: [EX_2627, EX_2526],
      loadConfigPourExercice: async (cwId) => ({ baseUrl: 'https://cw.test', cookie: `c-${cwId}` }),
      scrapeListe: async (cfg) => {
        const cwId = Number(cfg.cookie.replace('c-', ''));
        return {
          ecritures:
            cwId === 34
              ? [ligne(901, '2026-09-05', 1000), ligne(902, '2026-09-06', 1100)]
              : [ligne(801, '2026-08-24', 2000), ligne(802, '2026-08-25', 2100)],
        };
      },
      scanDrafts: async () => ({ crees: 0, existants: 0, supprimes: 0 }),
      scrapeDetail: async (cwId) => {
        fetches++;
        return { ventilations: [{ montantCents: cwId >= 900 ? 1000 : 2000, nature: null, activite: null, brancheprojet: null }] };
      },
      resolveActiviteId: async () => null,
      resolveUniteId: async () => null,
      resolveCategoryId: async () => null,
    });

    expect(fetches).toBe(2); // 2 au total, pas 2 par exercice
    expect(res.remaining).toBe(2); // le reste est drainé au cycle suivant
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run : `cd web && npx vitest run src/lib/services/__tests__/sync-cycle-deux-exercices.test.ts`
Attendu : ÉCHEC — `exercices` n'existe ni dans les options, ni dans le résultat.

- [ ] **Step 3: Ajouter la colonne `sync_runs.exercices`**

`business-schema.ts` : ajouter `exercices TEXT,` dans le `CREATE TABLE sync_runs` (après `scope TEXT,`) et, juste après le bloc `if (!srHas('remaining')) { … }` (≈ ligne 951), ajouter :

```ts
    // exercices : codes couverts par le run, séparés par des virgules
    // (ex. '2026-2027,2025-2026'). Nullable, pas de backfill : les runs
    // antérieurs à ADR-039 ne couvraient qu'un exercice, lequel est inconnu.
    if (!srHas('exercices')) {
      await db.exec('ALTER TABLE sync_runs ADD COLUMN exercices TEXT');
    }
```

- [ ] **Step 4: Extraire `syncUnExercice` et boucler**

Dans `sync-cycle.ts` :

1. Ajouter aux options et au résultat :

```ts
  /** Injection pour tests : exercices à synchroniser. Sinon découverte via CW. */
  exercices?: ExerciceActif[];
  /** Injection pour tests : ouvre la session d'un exercice. */
  loadConfigPourExercice?: (cwId: number) => Promise<ComptawebConfig>;
```
```ts
  /** Codes des exercices effectivement synchronisés (ex. ['2026-2027','2025-2026']). */
  exercices: string[];
```
(et `exercices: []` dans le `empty(...)`, `exercices: string | null` dans `SyncRunRow`.)

2. Déplacer le corps actuel des étapes 3 à 7f dans :

```ts
interface CompteursExercice {
  promoted: number;
  newDrafts: number;
  updatedMirror: number;
  supprimeeCw: number;
  imported: number;
  suggestionsCreated: number;
  detailFetches: number;
  remaining: number;
  warnings: string[];
}

/**
 * Un tour de sync sur UN exercice, avec la session de cet exercice. Le budget
 * de lectures détail est passé en paramètre (il est global au cycle : la
 * lambda a 60 s, quel que soit le nombre d'exercices).
 */
async function syncUnExercice(
  db: DbWrapper,
  groupId: string,
  config: ComptawebConfig,
  budgetDetail: number,
  opts: SyncCycleOptions,
  now: string,
): Promise<CompteursExercice> {
  // … corps inchangé des étapes 3 à 7f, avec `budgetDetail` à la place de
  // `opts.maxDetailFetches ?? MAX_DETAIL_FETCHES_PER_CYCLE`.
}
```

3. Dans `runSyncCycle`, remplacer l'appel unique par la découverte puis la boucle :

```ts
    const loadPourExercice = opts.loadConfigPourExercice ?? defaultLoadConfigPourExercice;

    // Exercices à couvrir : injectés (tests) ou découverts via CW + réglage groupe.
    let exercices = opts.exercices;
    if (!exercices) {
      const [groupe, page] = await Promise.all([
        getGroupe({ groupId }),
        withAutoReLogin((cfg) => fetchExercices(cfg)),
      ]);
      const calcul = exercicesActifs({
        exercicesCw: page.options,
        dernierExerciceClos: groupe?.dernier_exercice_clos ?? null,
      });
      if (calcul.avertissement) {
        logError('sync-cycle', 'exercice_courant_absent', null, { groupId, message: calcul.avertissement });
      }
      exercices = calcul.actifs;
    }

    let budgetRestant = opts.maxDetailFetches ?? MAX_DETAIL_FETCHES_PER_CYCLE;
    const codesCouverts: string[] = [];
    const warnings: string[] = [];
    // … compteurs cumulés à zéro …

    for (const exercice of exercices) {
      try {
        const config = await loadPourExercice(exercice.cwId);
        const c = await syncUnExercice(db, groupId, config, budgetRestant, opts, currentTimestamp());
        budgetRestant = Math.max(0, budgetRestant - c.detailFetches);
        remaining += c.remaining;
        // … cumuler les autres compteurs, pousser c.warnings …
        codesCouverts.push(exercice.code);
      } catch (err) {
        // Un exercice en échec ne doit pas emporter l'autre : la clôture se
        // joue sur les deux en parallèle (ADR-039).
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`exercice ${exercice.code} : ${message}`);
        logError('sync-cycle', 'exercice_en_echec', err, { groupId, syncRunId, exercice: exercice.code });
      }
    }
```

4. Écrire `exercices = ?` dans l'`UPDATE sync_runs` final (valeur `codesCouverts.join(',') || null`) et renvoyer `exercices: codesCouverts` dans le résultat.

5. Ajouter en haut du fichier :

```ts
import { exercicesActifs, type ExerciceActif } from './exercices-actifs';
import { fetchExercices } from '../comptaweb/exercices';
import { loadConfigPourExercice as defaultLoadConfigPourExercice, withAutoReLogin } from '../comptaweb/auth';
import { getGroupe } from './groupes';
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run : `cd web && npx vitest run src/lib/services/__tests__/sync-cycle-deux-exercices.test.ts`
Attendu : PASS (3 tests).

- [ ] **Step 6: Vérifier la non-régression complète**

Run : `cd web && npx vitest run && npx tsc --noEmit -p .`
Attendu : les ~1095 tests existants passent toujours (dont `sync-cycle.test.ts`, `sync-cycle-plafond.test.ts`, `sync-cycle-pool.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/services/sync-cycle.ts web/src/lib/db/business-schema.ts web/src/lib/services/__tests__/sync-cycle-deux-exercices.test.ts
git commit -m "feat(sync): un cycle couvre tous les exercices actifs"
```

---

### Task 6 : Créer l'écriture dans l'exercice de sa date

**Files:**
- Create: `web/src/lib/services/exercice-pour-ecriture.ts`
- Modify: `web/src/lib/services/drafts.ts` (≈ ligne 627), `web/src/lib/services/ecritures-create-cw-adapter.ts` (`defaultCwScraper`)
- Test: `web/src/lib/services/__tests__/exercice-pour-ecriture.test.ts`

**Interfaces:**
- Consomme : `exercicesActifs`, `exercicePourDate` (Task 1) ; `withComptaweb`, `withAutoReLogin` (Task 3) ; `fetchExercices` (Task 2) ; `getGroupe` (Task 4).
- Produit : `resoudreExercicePourDate(groupId: string, dateIso: string, deps?: ResoudreDeps): Promise<ExerciceActif>` — throw un message actionnable si la date n'appartient à aucun exercice actif.

- [ ] **Step 1: Écrire les tests qui échouent**

```ts
import { describe, it, expect, vi } from 'vitest';
import { resoudreExercicePourDate } from '../exercice-pour-ecriture';

const DEPS = {
  lireExercicesCw: async () => [
    { cwId: 34, libelle: 'Sept 2026 - Août 2027' },
    { cwId: 33, libelle: 'Sept 2025 - Août 2026' },
  ],
  lireDernierExerciceClos: async () => null,
  now: () => new Date('2026-09-15T10:00:00Z'),
};

describe('resoudreExercicePourDate', () => {
  it('une dépense de camp datée du 24/08 part sur l’exercice précédent', async () => {
    const ex = await resoudreExercicePourDate('g1', '2026-08-24', DEPS);
    expect(ex.cwId).toBe(33);
  });

  it('une écriture de rentrée datée du 05/09 part sur le nouvel exercice', async () => {
    const ex = await resoudreExercicePourDate('g1', '2026-09-05', DEPS);
    expect(ex.cwId).toBe(34);
  });

  it('exercice déclaré clos → refus, sans appel réseau, avec un message actionnable', async () => {
    const lireExercicesCw = vi.fn(DEPS.lireExercicesCw);
    await expect(
      resoudreExercicePourDate('g1', '2026-08-24', {
        ...DEPS,
        lireExercicesCw,
        lireDernierExerciceClos: async () => '2025-2026',
      }),
    ).rejects.toThrow(/2025-2026.*clos/i);
  });

  it('le message nomme la date et l’exercice concerné', async () => {
    await expect(
      resoudreExercicePourDate('g1', '2024-03-10', DEPS),
    ).rejects.toThrow(/10\/03\/2024/);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run : `cd web && npx vitest run src/lib/services/__tests__/exercice-pour-ecriture.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "../exercice-pour-ecriture"`.

- [ ] **Step 3: Écrire l'implémentation minimale**

```ts
// Route une écriture vers l'exercice CW de SA date (ADR-039). Une date hors des
// exercices actifs est refusée AVANT tout appel réseau : Comptaweb, lui,
// refuserait en silence par une redirection (cas 2026-09-11).
import { fetchExercices } from '../comptaweb/exercices';
import { withAutoReLogin } from '../comptaweb/auth';
import { getGroupe } from './groupes';
import {
  exercicePourDate,
  exercicesActifs,
  type ExerciceActif,
  type ExerciceCw,
} from './exercices-actifs';

export interface ResoudreDeps {
  lireExercicesCw?: () => Promise<ExerciceCw[]>;
  lireDernierExerciceClos?: () => Promise<string | null>;
  now?: () => Date;
}

function isoToFrCourt(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export async function resoudreExercicePourDate(
  groupId: string,
  dateIso: string,
  deps: ResoudreDeps = {},
): Promise<ExerciceActif> {
  const lireExercicesCw =
    deps.lireExercicesCw ?? (async () => (await withAutoReLogin((cfg) => fetchExercices(cfg))).options);
  const lireDernierExerciceClos =
    deps.lireDernierExerciceClos ??
    (async () => (await getGroupe({ groupId }))?.dernier_exercice_clos ?? null);

  const [exercicesCw, clos] = await Promise.all([lireExercicesCw(), lireDernierExerciceClos()]);
  const { actifs } = exercicesActifs({
    exercicesCw,
    now: (deps.now ?? (() => new Date()))(),
    dernierExerciceClos: clos,
  });

  const exercice = exercicePourDate(actifs, dateIso);
  if (exercice) return exercice;

  const annee = Number(dateIso.slice(0, 4));
  const mois = Number(dateIso.slice(5, 7));
  const debut = mois >= 9 ? annee : annee - 1;
  const code = `${debut}-${debut + 1}`;
  throw new Error(
    `Le ${isoToFrCourt(dateIso)} appartient à l'exercice ${code}, clos ou absent de Comptaweb — ` +
      `corrige la date, ou rouvre l'exercice dans /admin/parametres.`,
  );
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run : `cd web && npx vitest run src/lib/services/__tests__/exercice-pour-ecriture.test.ts`
Attendu : PASS (4 tests).

- [ ] **Step 5: Brancher les deux chemins de création**

`drafts.ts` — remplacer la ligne 627 :

```ts
    const exercice = await resoudreExercicePourDate(groupId, ecr.date_ecriture);
    const result = await withComptaweb(exercice.cwId, (cfg) => createEcriture(cfg, input, { dryRun }));
```
(importer `resoudreExercicePourDate` et `withComptaweb` ; retirer `withAutoReLogin` de l'import s'il n'est plus utilisé dans le fichier — `tsc` le dira.)

`ecritures-create-cw-adapter.ts` — `defaultCwScraper` reçoit déjà une `config` de son appelant. Le routage se fait donc côté appelant, `web/src/app/api/ecritures/route.ts` (≈ ligne 135, dans `createEcritureAndPushToCw`, où `groupId` vient de `ctxR.ctx` et `payload` de `parsed.data`) : remplacer `cwConfigLoader: loadConfig` par

```ts
      cwConfigLoader: async () => {
        const exercice = await resoudreExercicePourDate(groupId, payload.date_ecriture);
        return loadConfigPourExercice(exercice.cwId);
      },
```

Un exercice clos fait throw ici : la route l'attrape déjà (`catch`), l'écriture reste en `draft` et le message part au client — comportement voulu, identique à un refus CW.

- [ ] **Step 6: Vérifier**

Run : `cd web && npx vitest run && npx tsc --noEmit -p .`
Attendu : tout passe.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/services/exercice-pour-ecriture.ts web/src/lib/services/__tests__/exercice-pour-ecriture.test.ts web/src/lib/services/drafts.ts web/src/app/api/ecritures/route.ts
git commit -m "feat(ecritures): l'envoi vers CW choisit l'exercice de la date"
```

---

### Task 7 : Retirer le scope et basculer le domaine

**Files:**
- Modify: `web/src/lib/mcp/tools/sync.ts`, `web/src/app/api/sync/run/route.ts`, `web/src/components/ecritures/full-resync-button.tsx`
- Modify: `web/src/lib/comptaweb/auth.ts` (`DEFAULT_BASE_URL`), `web/src/lib/comptaweb-url.ts`

Deux commits distincts : le scope d'abord, le domaine ensuite.

- [ ] **Step 1: Neutraliser le scope (commit 1)**

`scope` reste accepté partout (compat des URL et du MCP) mais n'a plus d'effet : `scrapeListeEcritures` lit `/recettedepense?m=1`, qui renvoie déjà tout l'exercice du contexte (vérifié le 2026-09-11 : 363 écritures, du 01/09/2025 au 30/08/2026).

- Dans `ecritures-list-scrape.ts`, remplacer le commentaire `⚠️ Le mapping exact ...` par :
  ```
  // Note (2026-09-11, vérifié en live) : `/recettedepense` et
  // `/recettedepense?m=1` renvoient la MÊME chose — tout l'exercice du contexte
  // de session. `m=1` n'est qu'un marqueur de menu. Le paramètre `scope` est
  // conservé pour compat d'appel mais n'a plus d'effet (ADR-039).
  ```
  et faire pointer les deux branches sur `/recettedepense?m=1`.
- Dans `mcp/tools/sync.ts`, mettre à jour la description de `scope` : « Sans effet depuis ADR-039 : un cycle couvre toujours l'exercice complet de chaque exercice actif. Paramètre conservé pour compatibilité. »
- Dans `full-resync-button.tsx`, remplacer le libellé « Tout resynchroniser » par « Resynchroniser » et le toast « Réconciliation de tout l'exercice en cours… » par « Réconciliation en cours… ».

Run : `cd web && npx vitest run && npx tsc --noEmit -p .`

```bash
git add web/src/lib/comptaweb/ecritures-list-scrape.ts web/src/lib/mcp/tools/sync.ts web/src/components/ecritures/full-resync-button.tsx
git commit -m "refactor(sync): le scope n'a plus d'effet, CW renvoie tout l'exercice"
```

- [ ] **Step 2: Basculer le domaine (commit 2)**

Remplacer `https://sgdf.production.sirom.net` par `https://comptaweb.sgdf.fr` dans **trois** fichiers : `comptaweb/auth.ts` (`DEFAULT_BASE_URL`, ligne 11), `comptaweb-url.ts` (`COMPTAWEB_BASE_URL`, ligne 7) et `comptaweb/auth-automated.ts` (défaut de `opts.baseUrl`, ligne 170).

Deux tests figent l'ancien domaine — les traiter différemment :

- `src/lib/__tests__/comptaweb-url.test.ts` : l'URL attendue devient `https://comptaweb.sgdf.fr/recettedepense/2430377/afficher`. C'est le lien affiché à l'utilisateur, il doit suivre.
- `src/lib/comptaweb/__tests__/build-redirect-uri.test.ts` : **ne pas y toucher**. Ce test décrit ce que le JS de Comptaweb envoie (un hôte nu ou une URL déjà encodée) ; il reste valide. Ajouter seulement un cas :
  ```ts
  it('accepte le nouveau domaine tel quel', () => {
    expect(buildRedirectUri('https://comptaweb.sgdf.fr/')).toBe('https://comptaweb.sgdf.fr/');
  });
  ```

Les fixtures HTML (`__tests__/fixtures/*.html`) contiennent l'ancien domaine dans des `<link>` : **les laisser telles quelles**, ce sont des captures réelles.

Run : `cd web && npx vitest run && npx tsc --noEmit -p .`

```bash
git add web/src/lib/comptaweb/auth.ts web/src/lib/comptaweb-url.ts web/src/lib/comptaweb/auth-automated.ts
git commit -m "chore(comptaweb): bascule sur le domaine comptaweb.sgdf.fr"
```

- [ ] **Step 3: Vérification manuelle en prod (avec l'utilisateur)**

Après accord et push :
1. `/ecritures` → bouton « Resynchroniser » ;
2. vérifier dans `/admin/errors` qu'aucun `exercice_en_echec` n'apparaît ;
3. vérifier que des brouillons datés de septembre apparaissent (22 lignes bancaires du 01/09 au 10/09 attendues au 2026-09-13) ;
4. vérifier qu'aucune écriture d'août n'est passée en `supprimee_cw` : `list_ecritures(status='supprimee_cw', date_debut='2026-06-01')` doit rester vide.

---

## Notes d'exécution

- **Ordre imposé** : 1 → 2 → 3 → 4 → 5 → 6 → 7. Les tâches 5 et 6 dépendent des quatre premières.
- **Après la tâche 5, la prod voit enfin septembre** : c'est le jalon qui débloque le terrain. La tâche 6 débloque l'envoi des écritures d'août vers CW avant la clôture du 30/09.
- **Points laissés ouverts par la spec** (à ne pas traiter ici) : lisibilité d'une page de détail depuis la session d'un autre exercice ; découpage par exercice de la caisse, des cartes et des référentiels — ils restent sur `withAutoReLogin` (session `default`).
