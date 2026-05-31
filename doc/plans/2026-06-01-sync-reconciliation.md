# Réconciliation Comptaweb — Plan d'implémentation

> **For agentic workers:** plan exécuté en inline/TDD. Étapes en cases à cocher.

**Goal :** transformer la sync Comptaweb d'une promotion one-way en une réconciliation descendante continue (CW source de vérité : update des mirror, détection des suppressions, import des absentes, réconciliation des drafts).

**Architecture :** un cœur **pur et testable** `reconcile(snapshot, balooRows, plage)` qui décide ; l'orchestrateur `runSyncCycle` exécute (scrape, BDD, détail incrémental). Statuts gérés côté code (pas de CHECK). Migration idempotente. UI d'arbitrage (suppressions) + suggestions de lien.

**Tech Stack :** Next 16, libsql/Turso, cheerio (scrape), vitest. Spec : `doc/specs/2026-06-01-sync-reconciliation-design.md`.

---

## File structure

| Fichier | Resp. |
|---|---|
| `comptaweb/ecriture-detail-scrape.ts` (new) | parse `/recettedepense/<id>/afficher` → activité + brancheprojet |
| `comptaweb/ecritures-list-scrape.ts` (mod) | scope param (no-op recent / exercice) |
| `services/ecritures-sync-reconcile.ts` (new) | **pur** : diff snapshot↔baloo → plan d'actions |
| `services/ecritures-sync-transitions.ts` (new) | **pur** : guards de transitions |
| `services/cw-link-suggestions.ts` (new) | CRUD suggestions (UPSERT) |
| `services/sync-cycle.ts` (mod) | orchestration réconciliation |
| `db/business-schema.ts` (mod) | colonnes + table + backfill (helpers `ensure*`) |
| `mcp/tools/sync.ts` (mod) | `scope` param + counts |
| `lib/actions/ecritures-arbitrage.ts` (new) | server actions arbitrage + liens |
| `app/(app)/ecritures/*` (mod) | rendu supprimee_cw + encart suggestions |

---

## Task 1 — Migration BDD (colonnes + table + backfill)

**Files:** Modify `web/src/lib/db/business-schema.ts`. Test `web/src/lib/db/business-schema-reconcile.test.ts`.

- [ ] Ajouter helper `ensureReconcileSchema(db)` : `ALTER ecritures ADD COLUMN cw_signature TEXT` (si absente, via PRAGMA) ; sur `sync_runs` : ADD COLUMN `updated_mirror`/`supprimee_cw_detected`/`imported_from_cw`/`link_suggestions_created`/`detail_fetches` (INTEGER DEFAULT 0) + `scope TEXT` ; `CREATE TABLE IF NOT EXISTS cw_link_suggestions(...)` + index `(group_id,status)` **après**.
- [ ] Backfill `comptaweb_ecriture_id` : `UPDATE ecritures SET comptaweb_ecriture_id = CAST(cw_numero_piece AS INTEGER) WHERE comptaweb_ecriture_id IS NULL AND cw_numero_piece GLOB '[0-9]*' AND cw_numero_piece NOT GLOB '*[^0-9]*'`.
- [ ] Câbler `ensureReconcileSchema` dans `ensureBusinessSchema` après `ensureEcrituresCwNumeroPiece`.
- [ ] Ajouter au `CREATE TABLE ecritures` canonique : `cw_signature TEXT` ; au `CREATE TABLE sync_runs` canonique : les 5 INTEGER + `scope`.
- [ ] Tests : colonnes présentes après ensure, idempotence (2 appels), backfill ne touche pas un id déjà posé, backfill ignore cw_numero_piece non-numérique (ECR-2026-1).

**Test sketch :**
```ts
await ensureBusinessSchema(db);
const cols = await db.prepare('PRAGMA table_info(ecritures)').all<{name:string}>();
expect(cols.some(c=>c.name==='cw_signature')).toBe(true);
// backfill
await db.prepare("INSERT INTO ecritures(id,group_id,date_ecriture,description,amount_cents,type,status,cw_numero_piece) VALUES('E1','G','2026-01-01','x',100,'depense','pending_sync','4242')").run();
await ensureReconcileSchema(db);
const r = await db.prepare("SELECT comptaweb_ecriture_id FROM ecritures WHERE id='E1'").get<{comptaweb_ecriture_id:number}>();
expect(r?.comptaweb_ecriture_id).toBe(4242);
```

---

## Task 2 — Transitions pures

**Files:** Create `web/src/lib/services/ecritures-sync-transitions.ts`. Test `…/__tests__/ecritures-sync-transitions.test.ts`.

- [ ] `export type EcritureStatus = 'draft'|'pending_cw'|'pending_sync'|'mirror'|'divergent'|'supprimee_cw'`.
- [ ] `isAllowedSyncTransition(from, to): boolean` : autorise `mirror|pending_sync → supprimee_cw`, `draft → mirror`, `supprimee_cw → draft`, `pending_sync → mirror|divergent`, identité. Reste interdit.
- [ ] `canHardDelete(status, hasAttachments): boolean` : true seulement `draft`/`supprimee_cw` ET `!hasAttachments`.
- [ ] Tests exhaustifs autorisé/interdit.

---

## Task 3 — Cœur de réconciliation (pur)

**Files:** Create `web/src/lib/services/ecritures-sync-reconcile.ts`. Test `…/__tests__/ecritures-sync-reconcile.test.ts`.

Types :
```ts
export interface CwSnapshotRow { cwId:number; numeroPiece:string; date:string; type:'depense'|'recette'; montantCents:number; intitule:string; modeTransaction:string; categorieTiers:string; signature:string; }
export interface BalooRow { id:string; status:string; comptawebEcritureId:number|null; amountCents:number; type:'depense'|'recette'; dateEcriture:string; cwSignature:string|null; }
export interface ReconcilePlan {
  updates: { ecritureId:string; cw:CwSnapshotRow; needsDetail:boolean }[];
  promotions: { ecritureId:string; cw:CwSnapshotRow }[];   // drafts → mirror (match unique)
  deletions: string[];                                      // ecritureId → supprimee_cw
  imports: CwSnapshotRow[];                                 // créer mirror
  suggestions: { ecritureId:string; cw:CwSnapshotRow }[];   // ambigus
}
export function reconcile(snapshot:CwSnapshotRow[], baloo:BalooRow[], opts:{ dateToleranceDays:number }): ReconcilePlan
```

Logique (ordre spec) :
- `plage = [min(cwId), max(cwId)]` du snapshot (si vide → pas de deletions).
- index snapshot par cwId.
- **stable** : baloo avec `comptawebEcritureId` non null → si présent dans snapshot → `updates` (needsDetail = signature diff || row sans activité-info — ici on passe `needsDetail = cwSignature !== cw.signature`) ; sinon si comptawebEcritureId ∈ plage → `deletions` ; sinon (hors plage) → ignore.
- **drafts** : baloo `status==='draft'` && comptawebEcritureId null → candidats CW restants (non déjà matchés stable) avec `montantCents`+`type` égaux et `|date diff| ≤ tol`. compte candidats des deux côtés :
  - exactement 1 draft ↔ 1 cw → `promotions`.
  - sinon → `suggestions` (pour chaque paire candidate), pas de promotion.
- **imports** : lignes CW jamais matchées (ni stable, ni promotion, ni suggestion) → `imports`.

- [ ] Tests : update signature changée/inchangée (needsDetail), deletion in-range, hors-range ignorée, plage vide, import simple, draft match unique→promotion, draft ambigu (2 même montant/date)→suggestions+0 import des concernées, draft hors tolérance date→pas de match→import.

---

## Task 4 — Scraper page détail

**Files:** Create `web/src/lib/comptaweb/ecriture-detail-scrape.ts`. Test `…/__tests__/ecriture-detail-scrape.test.ts`.

- [ ] `parseEcritureDetailHtml(html): { activite:string|null; brancheprojet:string|null }` (cheerio ; cherche les libellés des champs activité / branche-projet sur la page afficher — sélecteurs robustes par label texte).
- [ ] `scrapeEcritureDetail(config, cwId): Promise<…>` via `fetchHtml(config, '/recettedepense/'+cwId+'/afficher')`.
- [ ] Test sur fixture HTML synthétique inline (activité + branche présentes / absentes).

> Sélecteurs à confirmer sur fixture réelle au moment de l'exécution. Fallback : null si introuvable (log côté caller), ne bloque pas la sync.

---

## Task 5 — Service suggestions de lien

**Files:** Create `web/src/lib/services/cw-link-suggestions.ts`. Test `…/__tests__/cw-link-suggestions.test.ts`.

- [ ] `upsertSuggestion(db,{groupId,ecritureId,cw})` : INSERT si pas de (group,ecriture,cw_ecriture_id) en `a_confirmer`/`confirme` ; sinon no-op. Pas de DELETE.
- [ ] `listSuggestions(db,groupId,status='a_confirmer')`.
- [ ] `resolveSuggestion(db,id,'confirme'|'rejete')` (update status + resolved_at).
- [ ] Tests : pas de doublon, resolve, list filtré.

---

## Task 6 — Réécriture `runSyncCycle`

**Files:** Modify `web/src/lib/services/sync-cycle.ts`. Test `…/__tests__/sync-cycle.test.ts` (étendre).

- [ ] Garder shouldSkip/getSyncStatus/throttle/verrou (régression ADR-032).
- [ ] Nouveau flux : backfill → scrape(scope) → charge balooRows (mirror/pending_sync/draft) → `reconcile()` → exécute le plan :
  - updates : si needsDetail → `scrapeEcritureDetail` (compteur detail_fetches), map activité→activite_id (par comptaweb_id/nom), branche→unite_id ; UPDATE champs comptables + cw_signature (jamais notes/justif). Compteur updated_mirror.
  - promotions : UPDATE draft → mirror + comptaweb_ecriture_id + copie + détail. Compteur promoted_to_mirror.
  - deletions : UPDATE → supprimee_cw. Compteur supprimee_cw_detected.
  - imports : INSERT mirror + détail. Compteur imported_from_cw.
  - suggestions : upsertSuggestion. Compteur link_suggestions_created.
- [ ] `SyncCycleOptions.scope?: 'recent'|'exercice'` ; passé au scrape ; stocké dans sync_runs.scope.
- [ ] Injections de test : `scrapeDetail`, mapping refs (loadActivites/loadUnites) injectables.
- [ ] Tests : un cycle bout-en-bout avec snapshot mocké couvrant update+delete+import+promotion+suggestion ; incrémentalité (signature inchangée → scrapeDetail non appelé) ; counts corrects ; scope persisté.

---

## Task 7 — Tool MCP `sync_run`

**Files:** Modify `web/src/lib/mcp/tools/sync.ts`. Test `…/__tests__/sync.test.ts`.

- [ ] Accepter `scope` (`recent` défaut). Inclure les nouveaux counts dans la sortie texte.
- [ ] Tests : sortie mentionne updated_mirror/imported/supprimees/suggestions ; scope transmis.

---

## Task 8 — Server actions arbitrage + liens

**Files:** Create `web/src/lib/actions/ecritures-arbitrage.ts`. Test pour les guards via le module transitions (Task 2) + un test action si faisable.

- [ ] `restaurerEnDraft(ecritureId)` : supprimee_cw → draft.
- [ ] `supprimerDefinitivement(ecritureId)` : garde-fou `canHardDelete` (statut + aucune pièce) → réutilise `deleteDraftEcriture` logique (vérif justif/dépôt/remb). Sinon throw explicite.
- [ ] `ignorerSuppression(ecritureId)` : no-op (reste supprimee_cw) — ou flag. (YAGNI : juste laisser tel quel ; action = ne rien faire, retirée si inutile.)
- [ ] `confirmerLien(suggestionId)` : promeut le draft (comptaweb_ecriture_id + copie + détail) + resolve confirme.
- [ ] `rejeterLien(suggestionId)` : resolve rejete.
- [ ] `'use server'` propre (pas de helper de lecture dedans — cf. AGENTS.md).

---

## Task 9 — UI `/ecritures`

**Files:** Modify ecritures page + table + status-badge.

- [ ] `status-badge.tsx` : libellé + couleur rouge pour `supprimee_cw`.
- [ ] Encart « À arbitrer » (supprimee_cw) avec actions restaurer/supprimer.
- [ ] Encart « Liens à confirmer » (listSuggestions) avec confirmer/rejeter.
- [ ] Pas de refonte : ajouts ciblés.

---

## Task 10 — ADR-035 + vérif finale

- [ ] ADR-035 dans `doc/decisions.md` (révise partiellement ADR-032 : statut + lien). Mettre ADR-032 « révisé par ADR-035 » sans réécrire son historique.
- [ ] `pnpm tsc`, `pnpm test`, `pnpm build` verts.
- [ ] Mettre à jour `doc/README.md` si besoin (nouvelle spec/plan listés).

---

## Self-review (couverture spec)

- update mirror (CW écrase) → T3 (updates) + T6. ✓
- suppressions + plage couverte → T3 (deletions/plage) + T6 + T8/T9 arbitrage. ✓
- import absentes → T3 (imports) + T6. ✓
- drafts match contenu + garde-fou + suggestions → T3 + T5 + T6 + T8/T9. ✓
- activité incrémentale (signature) → T1 (cw_signature) + T3 (needsDetail) + T4 (scraper) + T6. ✓
- clé stable + backfill → T1 + T3/T6. ✓
- statuts + transitions → T2. ✓
- audit sync_runs → T1 + T6. ✓
- migration cold start → T1. ✓
- ADR → T10. ✓
