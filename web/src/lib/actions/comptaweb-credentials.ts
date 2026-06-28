'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentContext } from '../context';
import { requireAdmin } from '../auth/access';
import { saveComptawebCredentials } from '../services/comptaweb-credentials';
import { loadConfig } from '../comptaweb/auth';
import { clearStoredSession } from '../comptaweb/session-store';
import { logError } from '../log';

// Enregistre les identifiants Comptaweb du groupe puis teste la connexion
// (rejoue un login). Le mot de passe est write-only : champ vide = inchangé.
export async function saveAndTestComptawebCredentials(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  requireAdmin(ctx.role);

  const username = ((formData.get('username') as string | null) ?? '').trim();
  const password = (formData.get('password') as string | null) ?? '';
  if (!username) {
    redirect('/import?cw_error=' + encodeURIComponent('Identifiant requis.'));
  }

  // 1. Enregistrer (toujours, même si le test échoue ensuite).
  try {
    await saveComptawebCredentials(ctx.groupId, ctx.userId, {
      username,
      password: password || undefined,
    });
  } catch (err) {
    logError('parametres', 'Enregistrement credentials Comptaweb échoué', err);
    redirect('/import?cw_error=' + encodeURIComponent('Échec de l’enregistrement.'));
  }

  // 2. Tester : on repart d'une session propre pour forcer un vrai login.
  //    redirect() lève NEXT_REDIRECT → JAMAIS dans le try/catch (sinon avalé).
  clearStoredSession();
  let testOk = false;
  try {
    await loadConfig();
    testOk = true;
  } catch (err) {
    logError('parametres', 'Test connexion Comptaweb échoué', err);
    testOk = false;
  }
  revalidatePath('/import');
  redirect('/import?cw_saved=' + (testOk ? 'ok' : 'failed'));
}
