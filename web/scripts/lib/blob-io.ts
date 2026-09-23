// I/O de blob partagée entre les scripts d'export (`export-dump.ts`,
// `export-exercice.ts`) : lire le corps d'une réponse `storage.fetch` et
// l'écrire de façon atomique sur disque.
//
// Extrait ici pour qu'un futur correctif d'atomicité ou de conversion de
// flux s'applique aux deux scripts d'un coup, plutôt que de risquer une
// dérive entre deux copies collées.
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Empreinte d'intégrité d'un blob, cf. ADR-040 (l'archive doit être
// vérifiable, pas juste présente) et spec §3 (`blobs/index.json` porte le
// sha256 de chaque fichier).
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// Convertit le corps d'une réponse `storage.fetch` en `Buffer`. Le FS local
// renvoie un `Uint8Array`, Vercel Blob renvoie un `ReadableStream` — les
// deux formes doivent être gérées.
export async function toBuffer(body: Uint8Array | ReadableStream<Uint8Array>): Promise<Buffer> {
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Écrit `buf` à `cible` de façon atomique : fichier temporaire `.part` puis
// `rename` vers le nom final. `rename` est atomique sur un même système de
// fichiers, donc un fichier présent sous son nom final est forcément
// complet — c'est ce qui rend la reprise fiable après une interruption
// (réseau, Ctrl-C, disque plein) : un `stat` qui réussit sur le nom final
// suffit à conclure « déjà là, pas à retélécharger ». Un `.part` résiduel
// d'un run précédent interrompu est nettoyé avant réécriture.
export async function ecrireAtomique(cible: string, buf: Buffer): Promise<void> {
  await mkdir(dirname(cible), { recursive: true });
  const partiel = `${cible}.part`;
  await unlink(partiel).catch(() => {});
  await writeFile(partiel, buf);
  await rename(partiel, cible);
}
