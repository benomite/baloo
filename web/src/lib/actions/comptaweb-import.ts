'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentContext } from '../context';
import { importComptawebCsv } from '../services/comptaweb-import';
import { logError } from '../log';

const ADMIN_ROLES = ['tresorier', 'RG'];

// Limite raisonnable pour un export Comptaweb : ~1 an de écritures.
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function uploadComptawebCsv(formData: FormData): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ADMIN_ROLES.includes(ctx.role)) {
    redirect('/import?error=' + encodeURIComponent('Action réservée aux trésoriers / RG.'));
  }

  const file = formData.get('csv');
  if (!(file instanceof File) || file.size === 0) {
    redirect('/import?error=' + encodeURIComponent('Sélectionne un fichier CSV.'));
  }
  if (file.size > MAX_FILE_SIZE) {
    redirect(
      '/import?error=' +
        encodeURIComponent(
          `Fichier trop volumineux (${Math.round(file.size / 1024 / 1024)} MB > 5 MB). Filtre la période côté Comptaweb avant export.`,
        ),
    );
  }

  const filename = file.name || 'export.csv';
  if (!/\.csv$/i.test(filename)) {
    redirect('/import?error=' + encodeURIComponent('Le fichier doit être un .csv.'));
  }

  const content = await file.text();

  let result;
  try {
    result = await importComptawebCsv({ groupId: ctx.groupId }, { filename, content });
  } catch (err) {
    logError('comptaweb-import', 'Import CSV échoué', err, { filename });
    const message = err instanceof Error ? err.message : String(err);
    redirect('/import?error=' + encodeURIComponent(message));
  }

  if (!result.ok) {
    redirect(
      '/import?error=' +
        encodeURIComponent(result.message ?? 'Import échoué (raison inconnue).'),
    );
  }

  revalidatePath('/import');
  revalidatePath('/ecritures');
  redirect(
    '/import?imported=' +
      encodeURIComponent(`${result.ecritures_creees ?? 0}|${result.fichier ?? filename}`),
  );
}
