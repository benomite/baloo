'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getCurrentContext } from '../context';
import { getDb } from '../db';
import { sendRelanceJustifEmail } from '../email/relance';

const ADMIN_ROLES = ['tresorier', 'RG'] as const;

async function deriveAppUrl(): Promise<string> {
  const explicit = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://localhost';
}

interface EcritureRow {
  id: string;
  description: string;
  amount_cents: number;
  type: 'depense' | 'recette';
  date_ecriture: string;
  group_id: string;
}

export async function sendRelance(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!(ADMIN_ROLES as readonly string[]).includes(ctx.role)) {
    redirect('/?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }

  const ecritureId = (formData.get('ecriture_id') as string | null)?.trim() ?? '';
  const destinataire = (formData.get('destinataire') as string | null)?.trim() ?? '';
  const customMessage = (formData.get('message') as string | null)?.trim() || null;

  const back = `/ecritures/${ecritureId}`;

  if (!ecritureId || !destinataire) {
    redirect(`${back}?error=` + encodeURIComponent('Email destinataire requis.'));
  }
  // Validation simple de l'email.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
    redirect(`${back}?error=` + encodeURIComponent('Email destinataire invalide.'));
  }

  const ecriture = await getDb()
    .prepare('SELECT id, description, amount_cents, type, date_ecriture, group_id FROM ecritures WHERE id = ? AND group_id = ?')
    .get<EcritureRow>(ecritureId, ctx.groupId);
  if (!ecriture) {
    redirect(`${back}?error=` + encodeURIComponent('Écriture introuvable.'));
  }

  try {
    await sendRelanceJustifEmail({
      to: destinataire,
      ecritureDescription: ecriture.description,
      ecritureAmountCents: ecriture.amount_cents,
      ecritureType: ecriture.type,
      ecritureDate: ecriture.date_ecriture,
      inviterName: ctx.name,
      appUrl: await deriveAppUrl(),
      customMessage,
    });
  } catch (err) {
    redirect(`${back}?error=` + encodeURIComponent(err instanceof Error ? err.message : String(err)));
  }

  redirect(`${back}?relanced=` + encodeURIComponent(destinataire));
}
