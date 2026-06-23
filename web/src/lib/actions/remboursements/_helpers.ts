import { headers } from 'next/headers';
import { getDb } from '../../db';
import { parseAmount } from '../../format';
import { parseDistanceToDixiemes, computeKmAmountCents } from '../../services/km';
import {
  JustificatifValidationError,
  validateJustifAttachment,
} from '../../services/justificatifs';

// Helpers partagés par les server actions du domaine remboursement.
// Pas de directive 'use server' ici : ces fonctions sont consommées
// uniquement par les fichiers du dossier (qui, eux, sont marqués
// 'use server'), elles ne sont pas exposées aux clients.

export const ADMIN_ROLES = ['tresorier', 'RG'];

// État retourné par les server actions de form au format `useActionState`.
// `null` = pas encore soumis / succès (le succès redirige et ne retourne
// donc jamais cette valeur).
export type RembFormState = { error: string } | null;

// Levée par les helpers `fail()` quand une validation échoue. Capturée au
// niveau de la server action, qui la convertit en `{ error }` retourné à
// `useActionState` — SANS redirect, pour que le formulaire ne soit pas
// vidé. Toute autre erreur (et le NEXT_REDIRECT du succès) se propage.
export class FormValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormValidationError';
  }
}

// Exécute le corps d'une server action de form et convertit une
// `FormValidationError` en état d'erreur retourné. Le `redirect()` de
// succès lève NEXT_REDIRECT, qui n'est pas une FormValidationError et se
// propage donc normalement (navigation).
export async function runFormAction(
  body: () => Promise<void>,
): Promise<RembFormState> {
  try {
    await body();
    return null;
  } catch (err) {
    if (err instanceof FormValidationError) return { error: err.message };
    throw err;
  }
}

export async function deriveAppUrl(): Promise<string> {
  const explicit = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://localhost';
}

// Emails des admins (trésorier/RG) ACTIFS du groupe donné. Le filtre
// `group_id = ?` garantit l'isolation multi-tenant : on ne notifie jamais
// les admins d'un autre groupe. `db` injectable pour les tests.
export async function listAdminEmails(
  groupId: string,
  db: Pick<ReturnType<typeof getDb>, 'prepare'> = getDb(),
): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT email FROM users WHERE group_id = ? AND statut = 'actif' AND role IN ('tresorier', 'RG')",
    )
    .all<{ email: string }>(groupId);
  return rows.map((r) => r.email);
}

// Récupère IP + user agent depuis les headers Next.js. Vercel set
// `x-forwarded-for` ; en local on tombe sur `x-real-ip` ou rien.
export async function captureClientMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null;
  const userAgent = h.get('user-agent') || null;
  return { ip, userAgent };
}

export interface IdentiteForm {
  prenom: string;
  nom: string;
  email: string;
}

export function parseIdentiteFromForm(
  formData: FormData,
  fail: (msg: string) => never,
): IdentiteForm {
  const prenom = (formData.get('prenom') as string | null)?.trim() ?? '';
  const nom = (formData.get('nom') as string | null)?.trim() ?? '';
  const email = (formData.get('email') as string | null)?.trim() ?? '';
  if (!prenom || !nom || !email) fail('Prénom, nom et email obligatoires.');
  return { prenom, nom, email };
}

export interface LigneInput {
  type: 'depense' | 'km';
  date: string;
  nature: string;
  amount_cents: number;            // dépense : saisi ; km : 0 jusqu'à résolution
  distance_km_dixiemes: number | null;
}

// Pré-valide les justificatifs uploadés (taille, extension, MIME)
// avant tout INSERT. Permet d'échouer tôt avec un message clair côté
// utilisateur, plutôt que de créer la demande puis d'avaler les
// erreurs au moment d'attacher (ce qui laisserait une rembs sans
// justif, contre-intuitif).
export function validateJustifFiles(
  files: File[],
  fail: (msg: string) => never,
): void {
  for (const f of files) {
    try {
      validateJustifAttachment({ filename: f.name, size: f.size, mime_type: f.type || null });
    } catch (err) {
      if (err instanceof JustificatifValidationError) fail(`${f.name} : ${err.message}`);
      throw err;
    }
  }
}

export function parseLignesFromForm(
  formData: FormData,
  fail: (msg: string) => never,
): LigneInput[] {
  const ligneCount = parseInt((formData.get('ligne_count') as string | null) ?? '0', 10);
  if (!ligneCount || ligneCount < 1) fail('Au moins une ligne de dépense est requise.');

  const lignes: LigneInput[] = [];
  for (let i = 0; i < ligneCount; i++) {
    const type = ((formData.get(`ligne_${i}_type`) as string | null) ?? 'depense') === 'km' ? 'km' : 'depense';
    const date = (formData.get(`ligne_${i}_date`) as string | null) ?? '';
    const nature = ((formData.get(`ligne_${i}_nature`) as string | null) ?? '').trim();
    if (!date || !nature) fail(`Ligne ${i + 1} incomplète.`);

    if (type === 'km') {
      const kmRaw = ((formData.get(`ligne_${i}_km`) as string | null) ?? '').trim();
      if (!kmRaw) fail(`Ligne ${i + 1} : nombre de km requis.`);
      let distance_km_dixiemes: number;
      try {
        distance_km_dixiemes = parseDistanceToDixiemes(kmRaw);
      } catch {
        fail(`Ligne ${i + 1} : distance invalide « ${kmRaw} ».`);
        return null as never;
      }
      lignes.push({ type: 'km', date, nature, amount_cents: 0, distance_km_dixiemes });
    } else {
      const montantRaw = ((formData.get(`ligne_${i}_montant`) as string | null) ?? '').trim();
      if (!montantRaw) fail(`Ligne ${i + 1} incomplète.`);
      let amount_cents: number;
      try {
        amount_cents = parseAmount(montantRaw);
      } catch {
        fail(`Ligne ${i + 1} : montant invalide « ${montantRaw} ».`);
        return null as never;
      }
      lignes.push({ type: 'depense', date, nature, amount_cents, distance_km_dixiemes: null });
    }
  }
  return lignes;
}

export interface ResolvedLigne {
  type: 'depense' | 'km';
  date: string;
  nature: string;
  amount_cents: number;
  distance_km_dixiemes: number | null;
  taux_km_millicents: number | null;
}

// Calcule le montant des lignes km au taux fourni (figé sur la ligne).
// Les lignes dépense gardent leur montant saisi.
export function resolveLignesWithRate(
  lignes: LigneInput[],
  tauxKmMillicents: number,
): ResolvedLigne[] {
  return lignes.map((l) =>
    l.type === 'km'
      ? {
          type: 'km' as const,
          date: l.date,
          nature: l.nature,
          amount_cents: computeKmAmountCents(l.distance_km_dixiemes ?? 0, tauxKmMillicents),
          distance_km_dixiemes: l.distance_km_dixiemes,
          taux_km_millicents: tauxKmMillicents,
        }
      : {
          type: 'depense' as const,
          date: l.date,
          nature: l.nature,
          amount_cents: l.amount_cents,
          distance_km_dixiemes: null,
          taux_km_millicents: null,
        },
  );
}
