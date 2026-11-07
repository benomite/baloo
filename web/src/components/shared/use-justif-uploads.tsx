'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadJustifFile } from '@/lib/justif-upload-client';
import type { UploadRef } from '@/lib/justif-allowed';

// Téléversement des justificatifs DÈS LEUR SÉLECTION (ticket #28) : chaque
// fichier part directement vers le storage, le formulaire ne soumet que
// des références (inputs cachés, cf. `<UploadedJustifInputs>`). Partagé par
// `FileMultiUploader`, `FileDrop`, `JustifMultiCapture` et la zone de dépôt
// d'une écriture.

export type JustifUploadState =
  | { status: 'uploading'; progress: number }
  | { status: 'done'; ref: UploadRef }
  | { status: 'error'; message: string };

export interface JustifUploads {
  stateOf: (file: File) => JustifUploadState | undefined;
  /** Au moins un fichier pas encore envoyé (ou en attente de départ). */
  pending: boolean;
  /** Références des fichiers envoyés, dans l'ordre de `files`. */
  refs: UploadRef[];
  /** Messages des envois échoués. */
  errors: string[];
}

// `settleMs` : délai avant de lancer l'envoi d'un fichier. Utile quand la
// liste change en rafale (capture retouchée : chaque filtre produit un
// nouveau fichier) — seul le dernier, resté stable, part.
export function useJustifUploads(files: File[], { settleMs = 0 }: { settleMs?: number } = {}): JustifUploads {
  const [states, setStates] = useState<Map<File, JustifUploadState>>(() => new Map());
  const started = useRef(new WeakSet<File>());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const file of files) {
      if (started.current.has(file)) continue;
      const start = () => {
        if (started.current.has(file)) return;
        started.current.add(file);
        const set = (s: JustifUploadState) =>
          setStates((prev) => {
            // Un événement de progression tardif n'écrase pas l'état final.
            if (s.status === 'uploading' && prev.get(file)?.status !== 'uploading' && prev.has(file)) return prev;
            const next = new Map(prev);
            next.set(file, s);
            return next;
          });
        set({ status: 'uploading', progress: 0 });
        uploadJustifFile(file, {
          onProgress: (p) => set({ status: 'uploading', progress: Math.min(99, Math.round(p)) }),
        })
          .then((ref) => set({ status: 'done', ref }))
          .catch((err) =>
            set({ status: 'error', message: err instanceof Error ? err.message : `Envoi de ${file.name} échoué.` }),
          );
      };
      if (settleMs > 0) timers.push(setTimeout(start, settleMs));
      else start();
    }
    return () => timers.forEach(clearTimeout);
  }, [files, settleMs]);

  const current = files.map((f) => states.get(f));
  return {
    stateOf: (f) => states.get(f),
    pending: current.some((s) => !s || s.status === 'uploading'),
    refs: current.flatMap((s) => (s?.status === 'done' ? [s.ref] : [])),
    errors: current.flatMap((s) => (s?.status === 'error' ? [s.message] : [])),
  };
}

// Inputs cachés embarqués dans le FormData du `<form>` parent : une
// référence JSON par fichier envoyé. Bloque aussi la soumission (validation
// native du navigateur) tant qu'un envoi est en cours ou en erreur, et si
// `required` sans aucun fichier.
export function UploadedJustifInputs({
  name,
  uploads,
  required,
}: {
  name: string;
  uploads: JustifUploads;
  required?: boolean;
}) {
  const guardRef = useRef<HTMLInputElement>(null);
  const message = uploads.pending
    ? 'Envoi des fichiers en cours, patiente quelques secondes.'
    : uploads.errors.length > 0
      ? 'Un fichier n’a pas pu être envoyé : retire-le puis ajoute-le à nouveau.'
      : required && uploads.refs.length === 0
        ? 'Ajoute au moins un fichier.'
        : '';

  useEffect(() => {
    guardRef.current?.setCustomValidity(message);
  }, [message]);

  return (
    <>
      {uploads.refs.map((r) => (
        <input key={r.pathname} type="hidden" name={name} value={JSON.stringify(r)} />
      ))}
      {/* Garde de soumission : sans `name`, n'entre pas dans le FormData. */}
      <input
        ref={guardRef}
        aria-hidden
        tabIndex={-1}
        className="sr-only"
        value=""
        onChange={() => {}}
        data-justif-guard={name}
      />
    </>
  );
}
