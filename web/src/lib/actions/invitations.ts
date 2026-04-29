'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  createInvitation as createInvitationService,
  type InvitationRole,
} from '../services/invitations';

const VALID_ROLES: readonly InvitationRole[] = ['tresorier', 'RG', 'chef', 'equipier', 'parent'];

async function deriveAppUrl(): Promise<string> {
  const explicit = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (explicit) return explicit;
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://localhost';
}

export async function createInvitation(formData: FormData): Promise<void> {
  const { groupId, userId, role } = await getCurrentContext();

  if (role !== 'tresorier' && role !== 'RG') {
    redirect('/admin/invitations?error=' + encodeURIComponent('Accès réservé aux trésoriers / RG.'));
  }

  const email = (formData.get('email') as string | null)?.trim() ?? '';
  const requestedRole = formData.get('role') as string | null;
  const scopeUniteId = (formData.get('scope_unite_id') as string | null) || null;
  const nomAffichage = (formData.get('nom_affichage') as string | null)?.trim() || null;

  if (!email) {
    redirect('/admin/invitations?error=' + encodeURIComponent('Email requis.'));
  }
  if (!requestedRole || !VALID_ROLES.includes(requestedRole as InvitationRole)) {
    redirect('/admin/invitations?error=' + encodeURIComponent('Rôle invalide.'));
  }

  let result;
  try {
    result = await createInvitationService(
      { groupId, inviterUserId: userId },
      {
        email,
        role: requestedRole as InvitationRole,
        scope_unite_id: scopeUniteId,
        nom_affichage: nomAffichage,
        app_url: await deriveAppUrl(),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    redirect('/admin/invitations?error=' + encodeURIComponent(message));
  }

  revalidatePath('/admin/invitations');
  const flag = result.email_sent ? 'sent' : 'created';
  redirect(`/admin/invitations?success=${encodeURIComponent(email)}&status=${flag}`);
}
