# Refonte de la fiche remboursement — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre la fiche remboursement plus logique et lisible (9 retours terrain) : permissions refuser/convertir/lier, lien→terminé auto, bug feuille PDF, fusion RIB, justifs par ligne, date d'édition lisible.

**Architecture:** Next 16 App Router. Les gardes de workflow vivent dans un module pur (`remboursements-transitions.ts`) et dans `applyRemboursementTransition` (service). Les server actions (`actions/remboursements/*`) appliquent + redirigent. La page `[id]/page.tsx` est un server component ; le formulaire d'édition et les cartes interactives sont des client components. Rendu PDF via pdfkit.

**Tech Stack:** TypeScript, Next 16, libsql/Turso, pdfkit, vitest.

## Global Constraints

- `pnpm` est CASSÉ dans `web/`. Lancer les tests avec `./node_modules/.bin/vitest run <pattern>` (depuis `web/`), le typecheck avec `./node_modules/.bin/tsc --noEmit`.
- **Jamais de DELETE de données métier** — UPSERT partout. Exception admise : la table de liaison pure `remboursement_ligne_justificatifs` (aucune donnée métier attachée) tolère DELETE+INSERT, comme déjà fait dans `setJustificatifLignes`.
- **Pas de `git push` sans accord explicite** (Vercel auto-deploy).
- Montants en centimes, stockés POSITIFS (le signe est d'affichage).
- Copie FR correcte (accents), pas d'engagement de délai.
- La garde de transition (`remboursements-transitions.ts` + `applyRemboursementTransition`) est la SOURCE DE VÉRITÉ des permissions ; l'UI ne fait que refléter (masquer un bouton) — toute règle doit exister côté serveur.
- Statuts : `a_traiter → valide_tresorier → valide_rg → virement_effectue → termine` (+ `refuse`, `converti`).

---

### Task 1 : Refuser uniquement avant validation RG (A1)

**Files:**
- Modify: `web/src/lib/services/remboursements-transitions.ts` (guard `refuse.from`)
- Modify: `web/src/app/(app)/remboursements/[id]/page.tsx:116` (`canRefuse`)
- Test: `web/src/lib/services/__tests__/remboursements-transitions.test.ts`

**Interfaces:**
- Consumes: `REMBOURSEMENTS_TRANSITIONS`, `isAllowedRembsTransition(from, target, role)`.
- Produces: rien de nouveau (comportement resserré).

- [ ] **Step 1: Test — refus autorisé depuis a_traiter et valide_tresorier seulement**

Ajouter dans le fichier de test existant (créer un `describe` dédié) :

```ts
import { describe, it, expect } from 'vitest';
import { isAllowedRembsTransition } from '../remboursements-transitions';

describe('refuse — resserré avant validation RG (A1)', () => {
  it('autorise le refus depuis a_traiter (trésorier ou RG)', () => {
    expect(isAllowedRembsTransition('a_traiter', 'refuse', 'tresorier')).toEqual({ ok: true });
    expect(isAllowedRembsTransition('a_traiter', 'refuse', 'RG')).toEqual({ ok: true });
  });
  it('autorise le refus depuis valide_tresorier', () => {
    expect(isAllowedRembsTransition('valide_tresorier', 'refuse', 'RG')).toEqual({ ok: true });
  });
  it('INTERDIT le refus depuis valide_rg', () => {
    expect(isAllowedRembsTransition('valide_rg', 'refuse', 'tresorier'))
      .toEqual({ ok: false, reason: 'wrong_source' });
  });
  it('INTERDIT le refus depuis virement_effectue', () => {
    expect(isAllowedRembsTransition('virement_effectue', 'refuse', 'tresorier'))
      .toEqual({ ok: false, reason: 'wrong_source' });
  });
});
```

- [ ] **Step 2: Lancer le test → échoue** (`valide_rg`/`virement_effectue` encore autorisés)

Run: `./node_modules/.bin/vitest run src/lib/services/__tests__/remboursements-transitions.test.ts`
Expected: FAIL sur les 2 derniers cas.

- [ ] **Step 3: Resserrer la garde**

Dans `remboursements-transitions.ts`, remplacer :

```ts
  refuse: {
    from: ['a_traiter', 'valide_tresorier', 'valide_rg', 'virement_effectue'],
    allowedRoles: ['tresorier', 'RG'],
  },
```

par :

```ts
  refuse: {
    // A1 : refus possible tant que la demande n'est pas validée RG — donc
    // seulement pendant qu'elle attend une validation (trésorier ou RG).
    from: ['a_traiter', 'valide_tresorier'],
    allowedRoles: ['tresorier', 'RG'],
  },
```

- [ ] **Step 4: Lancer le test → passe**

Run: `./node_modules/.bin/vitest run src/lib/services/__tests__/remboursements-transitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Aligner l'UI**

Dans `page.tsx`, remplacer la ligne 116 :

```ts
  const canRefuse = isAdmin && !['termine', 'refuse'].includes(r.status);
```

par :

```ts
  // A1 : refus possible seulement tant qu'une validation est attendue.
  const canRefuse = isAdmin && ['a_traiter', 'valide_tresorier'].includes(r.status);
```

- [ ] **Step 6: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit`

```bash
git add web/src/lib/services/remboursements-transitions.ts web/src/app/\(app\)/remboursements/\[id\]/page.tsx web/src/lib/services/__tests__/remboursements-transitions.test.ts
git commit -m "feat(rembs): refus limité à avant validation RG (A1)"
```

---

### Task 2 : Convertir en dépôt — trésorier seul, avant toute validation (A2)

**Files:**
- Modify: `web/src/lib/actions/remboursements/convert.ts` (garde rôle + statut)
- Modify: `web/src/app/(app)/remboursements/[id]/page.tsx:297` (`canConvert`)
- Test: `web/src/lib/actions/remboursements/__tests__/convert-guard.test.ts` (create)

La garde de statut a besoin du statut courant : charger le remboursement dans l'action. Extraire la logique de garde en fonction pure testable.

**Interfaces:**
- Produces: `canConvertRemboursement(role: string, status: string): boolean` (fonction pure exportée depuis `convert.ts` ou un helper).

- [ ] **Step 1: Test de la garde pure**

Créer `web/src/lib/actions/remboursements/__tests__/convert-guard.test.ts` (import depuis le helper pur `convert-guard`, PAS depuis l'action `convert` qui est un module `'use server'`) :

```ts
import { describe, it, expect } from 'vitest';
import { canConvertRemboursement } from '../convert-guard';

describe('canConvertRemboursement (A2)', () => {
  it('trésorier + a_traiter → true', () => {
    expect(canConvertRemboursement('tresorier', 'a_traiter')).toBe(true);
  });
  it('RG (même à_traiter) → false (trésorier seul)', () => {
    expect(canConvertRemboursement('RG', 'a_traiter')).toBe(false);
  });
  it('trésorier mais déjà validé → false', () => {
    expect(canConvertRemboursement('tresorier', 'valide_tresorier')).toBe(false);
    expect(canConvertRemboursement('tresorier', 'valide_rg')).toBe(false);
    expect(canConvertRemboursement('tresorier', 'virement_effectue')).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer → échoue** (`canConvertRemboursement` n'existe pas)

Run: `./node_modules/.bin/vitest run src/lib/actions/remboursements/__tests__/convert-guard.test.ts`
Expected: FAIL (import introuvable).

- [ ] **Step 3: Ajouter la garde pure + l'appliquer dans l'action**

Dans `convert.ts`, ajouter la fonction pure (hors du corps `'use server'` OK car exportée comme util — c'est un module `'use server'`, donc la fonction sera exposée comme action ; pour éviter ça, la définir dans un helper NON `'use server'`).

Créer `web/src/lib/actions/remboursements/convert-guard.ts` (pas de `'use server'`) :

```ts
// Garde pure A2 : conversion en dépôt réservée au trésorier, avant toute
// validation (statut a_traiter). Séparée de l'action pour être testable et
// pour ne pas être exposée comme server action.
export function canConvertRemboursement(role: string, status: string): boolean {
  return role === 'tresorier' && status === 'a_traiter';
}
```

Dans `convert.ts`, importer et l'utiliser (charger le rembs pour le statut) :

```ts
import { canConvertRemboursement } from './convert-guard';
import { getRemboursement } from '../../queries/remboursements';
// ...
export async function convertRembToDepot(id: string): Promise<void> {
  const ctx = await getCurrentContext();
  const rbt = await getRemboursement(id);
  if (!rbt || !canConvertRemboursement(ctx.role, rbt.status)) {
    redirect('/remboursements/' + id + '?error=' + encodeURIComponent(
      'Conversion possible seulement par le trésorier, sur une demande non validée.'));
  }
  // ... reste inchangé (try/convertRemboursementToDepot/redirect)
}
```

> Ne PAS réexporter `canConvertRemboursement` depuis `convert.ts` : tout export d'un module `'use server'` est traité comme une server action (cf. `web/AGENTS.md`). Le test et la page importent directement depuis `convert-guard`.

- [ ] **Step 4: Lancer → passe**

Run: `./node_modules/.bin/vitest run src/lib/actions/remboursements/__tests__/convert-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Aligner l'UI**

Dans `page.tsx`, remplacer la prop passée à `AdminActions` (ligne ~297) :

```tsx
              canConvert={!['virement_effectue', 'termine', 'converti'].includes(r.status)}
```

par :

```tsx
              canConvert={canConvertRemboursement(ctx.role, r.status)}
```

et importer en tête de `page.tsx` : `import { canConvertRemboursement } from '@/lib/actions/remboursements/convert-guard';`.

- [ ] **Step 6: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit`

```bash
git add web/src/lib/actions/remboursements/convert.ts web/src/lib/actions/remboursements/convert-guard.ts web/src/lib/actions/remboursements/__tests__/convert-guard.test.ts web/src/app/\(app\)/remboursements/\[id\]/page.tsx
git commit -m "feat(rembs): conversion en dépôt réservée trésorier + statut a_traiter (A2)"
```

---

### Task 3 : Lier seulement après virement + lien→terminé auto + délien→repli (A3, A4)

**Files:**
- Modify: `web/src/lib/actions/remboursements/link.ts` (garde statut sur link ; auto-termine ; unlink repli)
- Modify: `web/src/components/rembs/ecriture-link-card.tsx` (prop `status`, message si trop tôt)
- Modify: `web/src/app/(app)/remboursements/[id]/page.tsx` (passer `status` à `EcritureLinkCard`)
- Test: `web/src/lib/actions/remboursements/__tests__/link-guard.test.ts` (create) — garde pure

`applyRemboursementTransition(ctx, id, 'termine')` exige déjà `ecriture_id` non nul ET source `virement_effectue`. On l'appelle APRÈS avoir posé le lien.

**Interfaces:**
- Consumes: `setRembsEcritureLink(groupId, rbtId, ecritureId|null)`, `applyRemboursementTransition(ctx, id, target, opts)`.
- Produces: `canLinkEcriture(status: string): boolean` (pure, depuis un helper).

- [ ] **Step 1: Test garde pure de liaison**

Créer `web/src/lib/actions/remboursements/__tests__/link-guard.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { canLinkEcriture } from '../link-guard';

describe('canLinkEcriture (A3)', () => {
  it('virement_effectue → true', () => {
    expect(canLinkEcriture('virement_effectue')).toBe(true);
  });
  it('termine → true (re-lier / voir le lien)', () => {
    expect(canLinkEcriture('termine')).toBe(true);
  });
  it('avant le virement → false', () => {
    for (const s of ['a_traiter', 'valide_tresorier', 'valide_rg']) {
      expect(canLinkEcriture(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Lancer → échoue**

Run: `./node_modules/.bin/vitest run src/lib/actions/remboursements/__tests__/link-guard.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Helper de garde**

Créer `web/src/lib/actions/remboursements/link-guard.ts` (pas de `'use server'`) :

```ts
// Garde pure A3 : on ne peut lier une demande à une écriture comptable
// qu'une fois le virement effectué (avant, l'écriture n'existe pas). On
// autorise aussi `termine` pour re-lier / consulter (le passage en termine
// vient justement du lien — cf. A4).
export function canLinkEcriture(status: string): boolean {
  return status === 'virement_effectue' || status === 'termine';
}
```

- [ ] **Step 4: Appliquer la garde + auto-termine dans `link.ts`**

Dans `linkRemboursementToEcriture`, après le contrôle de rôle, charger le rembs et vérifier le statut ; après un lien réussi, tenter la transition `termine` (best-effort) :

```ts
import { canLinkEcriture } from './link-guard';
import { getRemboursement } from '../../queries/remboursements';
import { applyRemboursementTransition } from '../../services/remboursement-transition';
import { captureClientMeta, deriveAppUrl } from './_helpers';
// ...
export async function linkRemboursementToEcriture(rbtId: string, formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(`/remboursements/${rbtId}?error=${encodeURIComponent('Action réservée aux trésoriers / RG.')}`);
  }
  const rbt = await getRemboursement(rbtId);
  if (!rbt || !canLinkEcriture(rbt.status)) {
    redirect(`/remboursements/${rbtId}?error=${encodeURIComponent(
      "L'écriture comptable n'existe qu'une fois le virement effectué.")}`);
  }

  const ecritureId = formData.get('ecriture_id')?.toString().trim();
  if (!ecritureId) {
    redirect(`/remboursements/${rbtId}?error=${encodeURIComponent('Aucune écriture sélectionnée.')}`);
  }

  const result = await setRembsEcritureLink(ctx.groupId, rbtId, ecritureId);
  if (!result.ok) {
    redirect(`/remboursements/${rbtId}?error=${encodeURIComponent(result.error)}`);
  }

  // A4 : le lien matérialise le virement rapproché → passage en terminé auto.
  // Best-effort : si la transition échoue (ex. déjà terminé), le lien reste.
  const transition = await applyRemboursementTransition(
    { groupId: ctx.groupId, role: ctx.role, userId: ctx.userId, email: ctx.email, name: ctx.name, scopeUniteIds: ctx.scopeUniteIds },
    rbtId,
    'termine',
    { clientMeta: await captureClientMeta(), appUrl: await deriveAppUrl() },
  );
  if (!transition.ok) {
    logError('remboursements', 'Lien posé mais passage en terminé échoué', new Error(transition.message));
  }

  revalidatePath(`/remboursements/${rbtId}`);
  revalidatePath(`/ecritures/${ecritureId}`);
  if (result.previous) revalidatePath(`/ecritures/${result.previous}`);
  redirect(`/remboursements/${rbtId}?linked=${encodeURIComponent(ecritureId)}`);
}
```

> Attention `getRemboursement` : vérifier sa signature réelle. Dans `page.tsx` il est importé de `@/lib/queries/remboursements` et appelé `getRemboursement(id)`. Utiliser la même. Si elle exige un ctx, adapter.

- [ ] **Step 5: Délien → repli virement_effectue**

Dans `unlinkRemboursementFromEcriture`, après le `setRembsEcritureLink(..., null)` réussi, si le statut courant est `termine`, repli en `virement_effectue` (écriture directe du statut, PAS via applyTransition — il n'existe pas de transition régressive) :

```ts
  const rbt = await getRemboursement(rbtId);
  try {
    const result = await setRembsEcritureLink(ctx.groupId, rbtId, null);
    if (result.ok && result.previous) revalidatePath(`/ecritures/${result.previous}`);
    // Le passage en terminé venait du lien (A4) → le délier l'annule.
    if (rbt && rbt.status === 'termine') {
      await updateRemboursement({ groupId: ctx.groupId, scopeUniteIds: ctx.scopeUniteIds }, rbtId, { status: 'virement_effectue' });
    }
  } catch (err) {
    logError('remboursements', 'Délier rembs/écriture échoué', err);
  }
```

Importer `updateRemboursement` depuis `../../services/remboursements`.

- [ ] **Step 6: UI — carte de liaison conditionnée au statut**

Dans `ecriture-link-card.tsx`, ajouter `status: string` aux props, et si `!canLinkEcriture(status)` afficher un message au lieu du sélecteur :

```tsx
import { canLinkEcriture } from '@/lib/actions/remboursements/link-guard';
// dans le composant, AVANT la recherche de candidats :
  if (!ecritureId && !canLinkEcriture(status)) {
    return (
      <Section title="Écriture comptable">
        <p className="text-[12.5px] text-fg-muted italic">
          L&apos;écriture comptable du virement n&apos;existe qu&apos;une fois le virement effectué. Reviens ici à ce moment-là pour lier la demande.
        </p>
      </Section>
    );
  }
```

Dans `page.tsx`, passer la prop : `<EcritureLinkCard ... status={r.status} />`.

- [ ] **Step 7: Lancer les tests + typecheck**

Run: `./node_modules/.bin/vitest run src/lib/actions/remboursements/__tests__/link-guard.test.ts`
Run: `./node_modules/.bin/tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/actions/remboursements/link.ts web/src/lib/actions/remboursements/link-guard.ts web/src/lib/actions/remboursements/__tests__/link-guard.test.ts web/src/components/rembs/ecriture-link-card.tsx web/src/app/\(app\)/remboursements/\[id\]/page.tsx
git commit -m "feat(rembs): lien écriture seulement après virement + lien→terminé auto + délien→repli (A3/A4)"
```

---

### Task 4 : Bug feuille PDF — pdfkit sur Vercel (B)

**Files:**
- Create/Modify: `web/next.config.ts` (`serverExternalPackages: ['pdfkit']`)
- Test: `web/src/lib/pdf/__tests__/feuille-remboursement.test.ts` (create)

**Root cause (systematic-debugging) :** pdfkit 0.18 lit ses métriques `js/data/*.afm` via `fs` relatif à `__dirname`. Sur Vercel, le file-tracing de Next n'embarque pas ces `.afm` → `ENOENT` → `renderFeuilleRemboursementPdf` throw → l'appel best-effort dans `create.ts` avale l'erreur → feuille jamais générée.

- [ ] **Step 1: Confirmer la cause**

Lire l'erreur réelle en prod (module `remboursements`, message « Signature + génération PDF feuille échouée »). Deux voies :
1. Demander à l'utilisateur d'ouvrir `/admin/errors` et de copier la stack, OU
2. Interroger `error_log` en prod si l'URL/token Turso sont dans `web/.env.local` (script lecture seule `SELECT ... FROM error_log WHERE module='remboursements' ... ORDER BY created_at DESC LIMIT 5`).

Attendu : `ENOENT ... Helvetica.afm` (ou `.afm` similaire). Si la cause diffère, ajuster le fix et le signaler avant de continuer.

- [ ] **Step 2: Test garde — le rendu produit un PDF non vide**

Créer `web/src/lib/pdf/__tests__/feuille-remboursement.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { renderFeuilleRemboursementPdf } from '../feuille-remboursement';

describe('renderFeuilleRemboursementPdf', () => {
  it('produit un buffer PDF non vide (%PDF)', async () => {
    const buf = await renderFeuilleRemboursementPdf({
      rbt: {
        id: 'RBT-TEST', demandeur: 'Jean Test', prenom: 'Jean', nom: 'Test',
        email: 'jean@ex.org', unite_code: 'LOUV', status: 'a_traiter',
        amount_cents: 4250, total_cents: 4250, notes: null, rib_texte: 'FR76…',
        ecriture_id: null, motif_refus: null, nature: 'Tickets métro',
        // compléter les champs requis par le type Remboursement au besoin.
      } as never,
      lignes: [
        { id: 'L1', remboursement_id: 'RBT-TEST', type: 'depense', date_depense: '2026-07-12', nature: 'Métro', amount_cents: 4250, km: null } as never,
      ],
      groupName: 'Groupe Test',
      submittedAt: '2026-07-12',
      signatures: [],
    });
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
```

> L'implémenteur ajuste les champs de `rbt`/`lignes` pour satisfaire les types réels (`Remboursement`, `RemboursementLigne`). Le test doit compiler proprement (pas de `as never` si évitable).

- [ ] **Step 3: Lancer → passe en local** (les `.afm` sont présents localement)

Run: `./node_modules/.bin/vitest run src/lib/pdf/__tests__/feuille-remboursement.test.ts`
Expected: PASS. (Ce test garde le chemin de rendu contre une régression de code ; la validation Vercel se fait au déploiement.)

- [ ] **Step 4: Marquer pdfkit comme package serveur externe**

Lire d'abord `node_modules/next/dist/docs/` pertinent (cf. `web/AGENTS.md`) pour la clé exacte en Next 16. Éditer/créer `web/next.config.ts` pour ajouter au config object :

```ts
  // pdfkit lit ses métriques de police .afm via fs (__dirname). En le
  // déclarant "external", Next copie le package entier (avec js/data/*.afm)
  // dans la fonction serverless au lieu de le bundler → plus d'ENOENT sur
  // Vercel (feuille de remboursement qui ne se générait jamais).
  serverExternalPackages: ['pdfkit'],
```

Si `serverExternalPackages` n'est pas la clé Next 16 (vérifier la doc locale), utiliser l'équivalent (`experimental.serverComponentsExternalPackages` sur versions antérieures — mais Next 16 = `serverExternalPackages`).

- [ ] **Step 5: Typecheck + build local de la config**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: clean. (La preuve définitive est le déploiement Vercel — à valider après merge/push avec accord.)

- [ ] **Step 6: Commit**

```bash
git add web/next.config.ts web/src/lib/pdf/__tests__/feuille-remboursement.test.ts
git commit -m "fix(rembs): feuille PDF générée sur Vercel (pdfkit external, fin de l'ENOENT .afm) (B)"
```

---

### Task 5 : Bloc RIB compact (C1)

**Files:**
- Create: `web/src/components/rembs/coordonnees-bancaires-card.tsx`
- Modify: `web/src/app/(app)/remboursements/[id]/page.tsx` (remplacer la Section « Coordonnées bancaires » + supprimer la duplication RIB, déplacer en sidebar)
- Test: `web/src/components/rembs/__tests__/coordonnees-bancaires-card.test.tsx` (create)

Fusionne `rib_texte` (texte) et les fichiers RIB (`remboursement_rib`) en un seul bloc compact.

**Interfaces:**
- Produces: `CoordonneesBancairesCard({ ribTexte, ribFiles }: { ribTexte: string | null; ribFiles: { id: string; original_filename: string; file_path: string }[] })`.

- [ ] **Step 1: Test de rendu**

Créer `web/src/components/rembs/__tests__/coordonnees-bancaires-card.test.tsx` :

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoordonneesBancairesCard } from '../coordonnees-bancaires-card';

describe('CoordonneesBancairesCard (C1)', () => {
  it('affiche le texte IBAN et le lien fichier RIB', () => {
    render(<CoordonneesBancairesCard ribTexte="FR76 1234" ribFiles={[{ id: 'j1', original_filename: 'rib.pdf', file_path: 'remboursement_rib/RBT-1/rib.pdf' }]} />);
    expect(screen.getByText(/FR76 1234/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /rib\.pdf/ })).toHaveAttribute('href', '/api/justificatifs/remboursement_rib/RBT-1/rib.pdf');
  });
  it('affiche un message discret si aucune coordonnée', () => {
    render(<CoordonneesBancairesCard ribTexte={null} ribFiles={[]} />);
    expect(screen.getByText(/aucune coordonnée/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer → échoue** (composant absent)

Run: `./node_modules/.bin/vitest run src/components/rembs/__tests__/coordonnees-bancaires-card.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter le composant compact**

Créer `web/src/components/rembs/coordonnees-bancaires-card.tsx` :

```tsx
import { CreditCard } from 'lucide-react';
import { Section } from '@/components/shared/section';

interface Props {
  ribTexte: string | null;
  ribFiles: { id: string; original_filename: string; file_path: string }[];
}

// C1 : un seul bloc compact réunissant les 2 formats de la même info (texte
// IBAN + fichier RIB). Purement informatif pour le trésorier → discret.
export function CoordonneesBancairesCard({ ribTexte, ribFiles }: Props) {
  const rien = !ribTexte && ribFiles.length === 0;
  return (
    <Section title="Coordonnées bancaires">
      {rien ? (
        <p className="text-[12px] text-fg-muted italic">Aucune coordonnée fournie.</p>
      ) : (
        <div className="space-y-1.5">
          {ribTexte && (
            <p className="font-mono text-[11.5px] leading-snug text-fg break-all whitespace-pre-line">
              {ribTexte}
            </p>
          )}
          {ribFiles.map((j) => (
            <a
              key={j.id}
              href={`/api/justificatifs/${j.file_path}`}
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1.5 text-[12px] text-brand hover:underline underline-offset-2"
            >
              <CreditCard size={12} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{j.original_filename}</span>
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}
```

- [ ] **Step 4: Brancher dans la page + retirer l'ancienne Section**

Dans `page.tsx` :
- Supprimer la `Section title="Coordonnées bancaires"` de la colonne principale (lignes ~228-253).
- Dans la sidebar (`<aside>`), après `EcritureLinkCard`, insérer : `<CoordonneesBancairesCard ribTexte={r.rib_texte} ribFiles={ribFiles} />`.
- Importer le composant.

- [ ] **Step 5: Lancer le test + typecheck**

Run: `./node_modules/.bin/vitest run src/components/rembs/__tests__/coordonnees-bancaires-card.test.tsx`
Run: `./node_modules/.bin/tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/rembs/coordonnees-bancaires-card.tsx web/src/components/rembs/__tests__/coordonnees-bancaires-card.test.tsx web/src/app/\(app\)/remboursements/\[id\]/page.tsx
git commit -m "feat(rembs): bloc coordonnées bancaires compact (RIB texte + fichier fusionnés) (C1)"
```

---

### Task 6 : Justifs rattachés par ligne + justifs remontés (C2, C3)

**Files:**
- Modify: `web/src/lib/services/remboursement-justifs.ts` (ajouter `setLigneJustificatifs`)
- Create: `web/src/lib/actions/remboursements/assign-ligne-justifs.ts` (action orientée ligne)
- Modify: `web/src/lib/actions/remboursements/index.ts` (export)
- Modify: `web/src/components/rembs/detail-depenses-table.tsx` (affichage + rattachement par ligne)
- Modify: `web/src/app/(app)/remboursements/[id]/page.tsx` (fournir la liste des justifs de la demande au tableau ; remonter la zone d'upload ; réordonner la sidebar ; retirer le rattachement justif→lignes du bloc Justificatifs)
- Test: `web/src/lib/services/__tests__/remboursement-justifs-ligne.test.ts` (create)

Modèle inchangé (M:N `remboursement_ligne_justificatifs`). On ajoute la vue « depuis la ligne » : `setLigneJustificatifs(ligneId, justifIds)` remplace l'ensemble des justifs de CETTE ligne. Table de liaison pure → DELETE+INSERT toléré (même exception que `setJustificatifLignes`).

**Interfaces:**
- Consumes: `listAssignationsLignes`, `computeCouverture`.
- Produces:
  - `setLigneJustificatifs({ groupId }, remboursementId, ligneId, justificatifIds: string[]): Promise<void>`
  - action `assignLigneJustifs(remboursementId, ligneId, formData)` (`justif_ids` multiples).

- [ ] **Step 1: Test du service ligne→justifs**

Créer `web/src/lib/services/__tests__/remboursement-justifs-ligne.test.ts` (s'inspirer d'un test service existant pour le setup BDD in-memory : `createClient({ url: 'file::memory:' })`, PRAGMA FK off, CREATE des tables `justificatifs`, `remboursement_lignes`, `remboursement_ligne_justificatifs`, mock `../db` → `getDb`). Cas :

```ts
// après setup : 1 demande RBT-1, 2 lignes L1/L2, 2 justifs J1/J2 (entity remboursement RBT-1)
it('rattache J1 et J2 à la ligne L1', async () => {
  await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1', 'J2']);
  const a = await listAssignationsLignes('RBT-1');
  expect(a.filter((x) => x.ligne_id === 'L1').map((x) => x.justificatif_id).sort()).toEqual(['J1', 'J2']);
});
it('remplace la sélection (retire J2, garde J1)', async () => {
  await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1', 'J2']);
  await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1']);
  const a = await listAssignationsLignes('RBT-1');
  expect(a.filter((x) => x.ligne_id === 'L1').map((x) => x.justificatif_id)).toEqual(['J1']);
});
it('liste vide = retire tous les justifs de la ligne', async () => {
  await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J1']);
  await setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', []);
  expect((await listAssignationsLignes('RBT-1')).filter((x) => x.ligne_id === 'L1')).toHaveLength(0);
});
it('rejette un justif d\'une autre demande', async () => {
  await expect(setLigneJustificatifs({ groupId: 'g' }, 'RBT-1', 'L1', ['J-AUTRE'])).rejects.toThrow();
});
```

- [ ] **Step 2: Lancer → échoue** (`setLigneJustificatifs` absent)

Run: `./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-justifs-ligne.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter `setLigneJustificatifs`**

Dans `remboursement-justifs.ts`, ajouter (symétrique de `setJustificatifLignes`, axe ligne) :

```ts
// Remplace l'ensemble des justifs rattachés à CETTE ligne. `justificatifIds`
// vide = retire tous. Garde-fous : la ligne appartient à la demande, et chaque
// justif est bien déposé sur la demande (entity remboursement).
export async function setLigneJustificatifs(
  { groupId }: { groupId: string },
  remboursementId: string,
  ligneId: string,
  justificatifIds: string[],
): Promise<void> {
  const db = getDb();

  const ligne = await db
    .prepare('SELECT id FROM remboursement_lignes WHERE id = ? AND remboursement_id = ?')
    .get<{ id: string }>(ligneId, remboursementId);
  if (!ligne) throw new Error(`Ligne ${ligneId} n'appartient pas à la demande ${remboursementId}.`);

  const wanted = [...new Set(justificatifIds)];
  for (const jid of wanted) {
    const j = await db
      .prepare(`SELECT id FROM justificatifs WHERE id = ? AND group_id = ? AND entity_type = 'remboursement' AND entity_id = ?`)
      .get<{ id: string }>(jid, groupId, remboursementId);
    if (!j) throw new Error(`Justificatif ${jid} introuvable sur la demande ${remboursementId}.`);
  }

  // Table de liaison pure (aucune donnée métier) → on efface les paires de
  // CETTE ligne puis on ré-insère la sélection. Cf. exception DELETE CLAUDE.md.
  await db.prepare('DELETE FROM remboursement_ligne_justificatifs WHERE ligne_id = ?').run(ligneId);
  const now = currentTimestamp();
  for (const jid of wanted) {
    await db
      .prepare('INSERT INTO remboursement_ligne_justificatifs (ligne_id, justificatif_id, created_at) VALUES (?, ?, ?)')
      .run(ligneId, jid, now);
  }
}
```

- [ ] **Step 4: Lancer → passe**

Run: `./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-justifs-ligne.test.ts`
Expected: PASS.

- [ ] **Step 5: Action orientée ligne**

Créer `web/src/lib/actions/remboursements/assign-ligne-justifs.ts` :

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../../context';
import { setLigneJustificatifs } from '../../services/remboursement-justifs';
import { ADMIN_ROLES } from './_helpers';

// C2 : rattache à UNE ligne de détail la sélection de justifs de la demande
// (cases cochées côté trésorier). Réservé aux admins.
export async function assignLigneJustifs(
  remboursementId: string,
  ligneId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    throw new Error('Action réservée au trésorier.');
  }
  const justifIds = formData.getAll('justif_ids').filter((v): v is string => typeof v === 'string');
  await setLigneJustificatifs({ groupId: ctx.groupId }, remboursementId, ligneId, justifIds);
  revalidatePath(`/remboursements/${remboursementId}`);
}
```

Ajouter l'export dans `index.ts` : `export { assignLigneJustifs } from './assign-ligne-justifs';`.

- [ ] **Step 6: UI — rattachement par ligne dans `detail-depenses-table.tsx`**

Ce composant reçoit déjà `lignes` et `justifsParLigne`. Ajouter deux props : `demandeJustifs` (tous les justifs de la demande, pour la liste à cocher) et `canEdit` (admin), + `remboursementId`. Sous chaque ligne :
- si `justifsParLigne[l.id]` non vide : afficher chaque justif en lien `📎 nom` (ouvre `/api/justificatifs/<file_path>`).
- si `canEdit` : un `<details>` « + rattacher un justif » contenant un `<form action={assignLigneJustifs.bind(null, remboursementId, l.id)}>` avec une case par justif de la demande (`name="justif_ids"`, `defaultChecked` selon `justifsParLigne`), + `PendingButton` « Enregistrer ».

Structure (à intégrer au rendu existant de chaque ligne, en respectant le style tabulaire actuel) :

```tsx
{/* justifs rattachés à la ligne */}
{(justifsParLigne[l.id] ?? []).map((j) => (
  <a key={j.id} href={`/api/justificatifs/${j.file_path}`} target="_blank" rel="noopener"
     className="inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline underline-offset-2">
    <Paperclip size={11} strokeWidth={1.75} /> {j.original_filename}
  </a>
))}
{canEdit && demandeJustifs.length > 0 && (
  <details className="mt-0.5">
    <summary className="cursor-pointer text-[11.5px] text-fg-subtle hover:text-fg-muted">+ rattacher un justif</summary>
    <form action={assignLigneJustifs.bind(null, remboursementId, l.id)}
          className="mt-1.5 space-y-1 rounded-md border border-border-soft bg-bg-sunken/40 px-2.5 py-2">
      {demandeJustifs.map((j) => (
        <label key={j.id} className="flex items-start gap-2 text-[12px] cursor-pointer">
          <input type="checkbox" name="justif_ids" value={j.id}
                 defaultChecked={(justifsParLigne[l.id] ?? []).some((x) => x.id === j.id)}
                 className="mt-0.5 h-3.5 w-3.5 rounded border-border-strong text-brand" />
          <span className="truncate">{j.original_filename}</span>
        </label>
      ))}
      <div className="flex justify-end pt-1"><PendingButton variant="outline" size="sm">Enregistrer</PendingButton></div>
    </form>
  </details>
)}
```

> `detail-depenses-table.tsx` est un composant client ou serveur ? Vérifier. Un `<form action={serverAction.bind(...)}>` fonctionne dans un server component ; si le fichier est `'use client'`, importer l'action est OK aussi (server action importée). Respecter l'existant. Importer `assignLigneJustifs`, `Paperclip`, `PendingButton`.

- [ ] **Step 7: Page — fournir les justifs, remonter l'upload, réordonner, nettoyer**

Dans `page.tsx` :
- Passer à `DetailDepensesTable` : `demandeJustifs={justificatifs.map((j) => ({ id: j.id, original_filename: j.original_filename, file_path: j.file_path }))}`, `canEdit={isAdmin}`, `remboursementId={id}`.
- **Remonter l'upload** : déplacer le `<form action={uploadJustificatif}>` (aujourd'hui dans la Section Justificatifs de la sidebar) juste sous la Section « Détail des dépenses » dans la colonne principale (sous un intitulé « Ajouter un justificatif »).
- **Retirer** du bloc sidebar « Justificatifs » le `<details>` de rattachement justif→lignes (remplacé par le rattachement par ligne). Garder la simple liste des justifs (liens) — ou la retirer entièrement puisque les justifs sont désormais visibles par ligne ; conserver une liste compacte « Justificatifs (N) » sans les cases.
- **Réordonner la sidebar** : `EcritureLinkCard` → `CoordonneesBancairesCard` → Feuille → Signatures. (La liste des justifs restante peut passer sous la colonne principale ou rester en bas de sidebar, au choix de l'implémenteur, du moment que le rattachement par ligne est bien la voie principale.)

- [ ] **Step 8: Typecheck + suite ciblée**

Run: `./node_modules/.bin/tsc --noEmit`
Run: `./node_modules/.bin/vitest run src/lib/services/__tests__/remboursement-justifs-ligne.test.ts`
Expected: clean + PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/services/remboursement-justifs.ts web/src/lib/actions/remboursements/assign-ligne-justifs.ts web/src/lib/actions/remboursements/index.ts web/src/components/rembs/detail-depenses-table.tsx web/src/app/\(app\)/remboursements/\[id\]/page.tsx web/src/lib/services/__tests__/remboursement-justifs-ligne.test.ts
git commit -m "feat(rembs): justifs rattachés par ligne + remontés en tête de fiche (C2/C3)"
```

---

### Task 7 : Date de ligne lisible en édition (C4)

**Files:**
- Modify: `web/src/components/rembs/remboursement-form.tsx:237` (grille desktop)

Le champ est déjà `type="date"` mais sa colonne desktop fait `100px` → date + icône calendrier illisibles.

- [ ] **Step 1: Élargir la colonne Date**

Dans `remboursement-form.tsx`, ligne ~237, remplacer :

```tsx
              className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:grid sm:grid-cols-[110px_100px_1fr_140px_auto] sm:items-end sm:gap-3 sm:rounded-none sm:border-0 sm:p-0"
```

par (Date 150px ; Type resserré à 100px, Montant à 130px pour tenir la largeur) :

```tsx
              className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:grid sm:grid-cols-[100px_150px_1fr_130px_auto] sm:items-end sm:gap-3 sm:rounded-none sm:border-0 sm:p-0"
```

- [ ] **Step 2: Vérifier visuellement (dev) + typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: clean. (Vérifier en dev que la date est lisible et cliquable, mobile inchangé.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/rembs/remboursement-form.tsx
git commit -m "fix(rembs): colonne date lisible en édition de ligne (C4)"
```

---

## Ordre & dépendances

- T1, T2, T7 : indépendants, mécaniques.
- T3 : dépend de rien mais touche `page.tsx` (comme T1/T2/T5/T6) → conflits de merge possibles sur `page.tsx` ; exécuter en série (subagent-driven, une tâche à la fois).
- T4 : indépendant (PDF/config).
- T5 puis T6 : T6 réordonne la sidebar où T5 place la carte RIB → faire T5 avant T6.
- `page.tsx` est modifié par T1, T2, T3, T5, T6 → l'exécution séquentielle évite les collisions.

## Validation finale

- `./node_modules/.bin/vitest run` (suite complète verte).
- `./node_modules/.bin/tsc --noEmit` clean.
- Revue whole-branch.
- Merge/push seulement sur accord explicite. Après déploiement : vérifier en prod que la feuille PDF se génère (créer/valider une demande de test) et que `/admin/errors` ne logue plus l'échec pdfkit.
