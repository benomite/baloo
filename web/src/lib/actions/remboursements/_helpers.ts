import { headers } from 'next/headers';
import { getDb } from '../../db';
import { parseAmount } from '../../format';

// Helpers partagés par les server actions du domaine remboursement.
// Pas de directive 'use server' ici : ces fonctions sont consommées
// uniquement par les fichiers du dossier (qui, eux, sont marqués
// 'use server'), elles ne sont pas exposées aux clients.

export const ADMIN_ROLES = ['tresorier', 'RG'];

export async function deriveAppUrl(): Promise<string> {
  const explicit = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://localhost';
}

export async function listAdminEmails(groupId: string): Promise<string[]> {
  const rows = await getDb()
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
  date: string;
  nature: string;
  amount_cents: number;
}

export function parseLignesFromForm(
  formData: FormData,
  fail: (msg: string) => never,
): LigneInput[] {
  const ligneCount = parseInt((formData.get('ligne_count') as string | null) ?? '0', 10);
  if (!ligneCount || ligneCount < 1) fail('Au moins une ligne de dépense est requise.');

  const lignes: LigneInput[] = [];
  for (let i = 0; i < ligneCount; i++) {
    const date = (formData.get(`ligne_${i}_date`) as string | null) ?? '';
    const nature = ((formData.get(`ligne_${i}_nature`) as string | null) ?? '').trim();
    const montantRaw = ((formData.get(`ligne_${i}_montant`) as string | null) ?? '').trim();
    if (!date || !nature || !montantRaw) fail(`Ligne ${i + 1} incomplète.`);
    let amount_cents: number;
    try {
      amount_cents = parseAmount(montantRaw);
    } catch {
      fail(`Ligne ${i + 1} : montant invalide « ${montantRaw} ».`);
      return null as never;
    }
    lignes.push({ date, nature, amount_cents });
  }
  return lignes;
}
