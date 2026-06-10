import Link from 'next/link';
import { ChevronDown, Plus, Tent } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared/field';
import { EmptyState } from '@/components/shared/empty-state';
import { PendingButton } from '@/components/shared/pending-button';
import { UniteBadge } from '@/components/shared/unite-badge';
import { getCurrentContext } from '@/lib/context';
import { requireNotParent } from '@/lib/auth/access';
import { listCamps, type Camp, type CampStatut } from '@/lib/services/camps';
import { createCamp } from '@/lib/actions/camps';
import {
  listSelectableUnites,
  listSelectableActivites,
} from '@/lib/queries/reference';

const ADMIN_ROLES = ['tresorier', 'RG'];

// Badge de statut d'un camp — code couleur cohérent avec les chips
// métadonnées du reste de l'app (ambre = à venir, émeraude = actif,
// gris = terminé).
const STATUT_CHIP: Record<CampStatut, { label: string; className: string }> = {
  preparation: {
    label: 'Préparation',
    className:
      'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  },
  en_cours: {
    label: 'En cours',
    className:
      'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  },
  cloture: {
    label: 'Clôturé',
    className: 'bg-bg-sunken text-fg-muted',
  },
};

function StatutChip({ statut }: { statut: CampStatut }) {
  const s = STATUT_CHIP[statut] ?? STATUT_CHIP.preparation;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}

export default async function CampsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [ctx, params] = await Promise.all([getCurrentContext(), searchParams]);
  requireNotParent(ctx.role);
  const isAdmin = ADMIN_ROLES.includes(ctx.role);

  const [camps, unites, activites] = await Promise.all([
    listCamps({ groupId: ctx.groupId, scopeUniteId: ctx.scopeUniteId }),
    isAdmin ? listSelectableUnites() : Promise.resolve([]),
    isAdmin ? listSelectableActivites() : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Camps"
        subtitle="Suivi des camps : budget, dépenses, justificatifs."
      />

      {params.error && (
        <Alert variant="error" className="mb-4">
          {params.error}
        </Alert>
      )}

      {isAdmin && (
        <details className="group/new mb-6 rounded-xl border border-border-soft bg-bg-elevated overflow-hidden">
          <summary className="cursor-pointer list-none flex items-center gap-2 px-4 py-3 text-[13.5px] font-medium text-fg transition-colors hover:bg-bg-sunken/40">
            <Plus size={15} strokeWidth={2.25} className="text-brand" />
            Nouveau camp
            <ChevronDown
              size={14}
              strokeWidth={2.25}
              className="ml-auto text-fg-subtle transition-transform group-open/new:rotate-180"
            />
          </summary>
          <CreateCampForm unites={unites} activites={activites} />
        </details>
      )}

      {camps.length === 0 ? (
        <EmptyState
          emoji="⛺"
          title="Aucun camp pour le moment"
          description={
            isAdmin
              ? 'Crée un camp pour suivre son budget, ses dépenses et ses justificatifs au fil de l’été.'
              : 'Aucun camp n’est encore suivi pour ton unité. Le trésorier en créera un le moment venu.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-soft rounded-xl border border-border-soft bg-bg-elevated overflow-hidden shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          {camps.map((c) => (
            <CampRow key={c.id} camp={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampRow({ camp }: { camp: Camp }) {
  const dates =
    camp.date_debut || camp.date_fin
      ? `${camp.date_debut ?? '?'} → ${camp.date_fin ?? '?'}`
      : null;
  return (
    <li className="transition-colors hover:bg-bg-sunken/40">
      <Link href={`/camps/${camp.id}`} className="flex items-center gap-3 px-4 py-3.5">
        <Tent size={16} strokeWidth={2} className="shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[14px] text-fg truncate">
              {camp.name}
            </span>
            <StatutChip statut={camp.statut} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-muted">
            <UniteBadge
              code={camp.unite_code}
              name={camp.unite_name}
              couleur={camp.unite_couleur}
            />
            {dates && <span className="tabular-nums">{dates}</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

function CreateCampForm({
  unites,
  activites,
}: {
  unites: Awaited<ReturnType<typeof listSelectableUnites>>;
  activites: Awaited<ReturnType<typeof listSelectableActivites>>;
}) {
  return (
    <form action={createCamp} className="border-t border-border-soft p-4 space-y-4">
      <Field label="Nom du camp" htmlFor="name" required>
        <Input
          id="name"
          name="name"
          required
          placeholder="Camp d'été 2026 — Scouts-Guides"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Unité" htmlFor="unite_id" required>
          <NativeSelect id="unite_id" name="unite_id" required defaultValue="">
            <option value="" disabled>
              — Choisir une unité —
            </option>
            {unites.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.code ?? u.id}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          label="Activité Comptaweb"
          htmlFor="activite_id"
          required
          hint="souvent l’activité générique « Camp »"
        >
          <NativeSelect id="activite_id" name="activite_id" required defaultValue="">
            <option value="" disabled>
              — Choisir une activité —
            </option>
            {activites.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <p className="-mt-2 text-[11.5px] text-fg-subtle">
        Le camp = cette activité × l’unité (branche/pôle Comptaweb). Plusieurs
        camps peuvent partager la même activité « Camp », c’est l’unité qui les
        distingue. Si l’activité n’existe pas encore dans Comptaweb, crée-la
        puis lance la sync des référentiels.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Date de début" htmlFor="date_debut">
          <Input id="date_debut" name="date_debut" type="date" />
        </Field>
        <Field label="Date de fin" htmlFor="date_fin">
          <Input id="date_fin" name="date_fin" type="date" />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" hint="optionnel">
        <Textarea id="notes" name="notes" rows={3} placeholder="Lieu, effectif, points d’attention…" />
      </Field>

      <div className="flex justify-end">
        <PendingButton>Créer le camp</PendingButton>
      </div>
    </form>
  );
}
