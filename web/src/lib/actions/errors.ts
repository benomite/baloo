'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import {
  markErrorGroupResolved,
  markErrorResolved,
  markErrorUnresolved,
} from '../services/errors';

const ADMIN_ROLES = ['tresorier', 'RG'];

async function requireAdminCtx() {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect(
      '/admin/errors?error=' +
        encodeURIComponent('Action réservée aux trésoriers / RG.'),
    );
  }
  return ctx;
}

export async function resolveError(id: string): Promise<void> {
  const ctx = await requireAdminCtx();
  await markErrorResolved(id, ctx.userId);
  revalidatePath('/admin/errors');
  redirect('/admin/errors?resolved=' + encodeURIComponent(id));
}

export async function reopenError(id: string): Promise<void> {
  await requireAdminCtx();
  await markErrorUnresolved(id);
  revalidatePath('/admin/errors');
  redirect('/admin/errors?reopened=' + encodeURIComponent(id));
}

export async function resolveErrorGroup(formData: FormData): Promise<void> {
  const ctx = await requireAdminCtx();
  const mod = (formData.get('mod') as string | null)?.trim() ?? '';
  const message = (formData.get('message') as string | null)?.trim() ?? '';
  if (!mod || !message) {
    redirect('/admin/errors?error=' + encodeURIComponent('mod / message manquant.'));
  }
  const count = await markErrorGroupResolved(mod, message, ctx.userId);
  revalidatePath('/admin/errors');
  redirect('/admin/errors?group_resolved=' + encodeURIComponent(`${count}`));
}
