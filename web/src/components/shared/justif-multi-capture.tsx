'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { JustifCapture } from './justif-capture';

// JustifMultiCapture : permet de joindre PLUSIEURS pièces à un même
// dépôt, chacune passant par le workflow riche de `JustifCapture`
// (détection de document, recadrage, filtres, compression).
//
// Principe :
//   - `committed` : les pièces déjà validées (figées), affichées en
//     vignettes au-dessus.
//   - `draft` : la pièce en cours de capture, remontée par l'instance
//     active de `JustifCapture` via `onReady`.
//   - Un seul <input type="file" name multiple> caché embarque
//     l'ensemble (committed + draft) dans le FormData au submit. Du coup
//     le cas mono-fichier « marche tout seul » : pas besoin de cliquer
//     « Ajouter » si on ne dépose qu'une pièce.
//   - « Ajouter un autre fichier » fige le draft dans `committed` et
//     remonte une instance vierge de `JustifCapture` (via `captureKey`).

interface CommittedFile {
  id: number;
  file: File;
  previewUrl?: string;
}

let _seq = 0;

export function JustifMultiCapture({
  name,
  required,
}: {
  name: string;
  required?: boolean;
}) {
  const [committed, setCommitted] = useState<CommittedFile[]>([]);
  const [draft, setDraft] = useState<File | null>(null);
  const [captureKey, setCaptureKey] = useState(0);
  const realInputRef = useRef<HTMLInputElement>(null);

  const allFiles = useMemo(
    () => [...committed.map((c) => c.file), ...(draft ? [draft] : [])],
    [committed, draft],
  );
  const allFilesRef = useRef<File[]>(allFiles);

  const syncInput = useCallback(() => {
    if (!realInputRef.current) return;
    const dt = new DataTransfer();
    for (const f of allFilesRef.current) dt.items.add(f);
    realInputRef.current.files = dt.files;
  }, []);

  // Synchronise l'input file caché (celui qui part dans le FormData).
  useEffect(() => {
    allFilesRef.current = allFiles;
    syncInput();
  }, [allFiles, syncInput]);

  // React vide l'input après chaque exécution de l'action (même sur
  // erreur) en réinitialisant le <form>. On ré-applique nos fichiers
  // pour qu'un renvoi ne les perde pas silencieusement.
  useEffect(() => {
    const form = realInputRef.current?.form;
    if (!form) return;
    const onReset = () => queueMicrotask(syncInput);
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, [syncInput]);

  // Cleanup des object URLs au démontage.
  useEffect(() => {
    return () => {
      for (const c of committed) if (c.previewUrl) URL.revokeObjectURL(c.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAnother = () => {
    if (!draft) return;
    const previewUrl = draft.type.startsWith('image/')
      ? URL.createObjectURL(draft)
      : undefined;
    setCommitted((prev) => [...prev, { id: ++_seq, file: draft, previewUrl }]);
    setDraft(null);
    setCaptureKey((k) => k + 1); // remonte une capture vierge
  };

  const removeCommitted = (id: number) => {
    setCommitted((prev) => {
      const found = prev.find((c) => c.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((c) => c.id !== id);
    });
  };

  return (
    <div className="space-y-3">
      <input
        ref={realInputRef}
        type="file"
        name={name}
        multiple
        accept="image/*,application/pdf"
        required={required && allFiles.length === 0}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      {committed.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {committed.map((c, i) => (
            <li
              key={c.id}
              className="relative overflow-hidden rounded-lg border border-border-soft bg-bg-sunken"
            >
              {c.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.previewUrl}
                  alt={`Pièce ${i + 1}`}
                  className="h-24 w-full object-cover"
                />
              ) : (
                <div className="flex h-24 w-full flex-col items-center justify-center gap-1 text-fg-muted">
                  <span className="font-mono text-[10px] uppercase tracking-wide rounded px-2 py-0.5 bg-brand-50 text-brand">
                    PDF
                  </span>
                  <span className="max-w-full truncate px-2 text-[11px]">{c.file.name}</span>
                </div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-bg/85 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted shadow-sm">
                Pièce {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeCommitted(c.id)}
                aria-label={`Retirer la pièce ${i + 1}`}
                className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-bg/85 text-fg-muted shadow-sm hover:bg-destructive hover:text-white transition-colors"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <JustifCapture key={captureKey} onReady={setDraft} />

      <button
        type="button"
        onClick={addAnother}
        disabled={!draft}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-bg-elevated px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:border-brand hover:text-brand disabled:opacity-50 disabled:hover:border-border disabled:hover:text-fg"
      >
        <Plus size={14} strokeWidth={2} />
        Ajouter un autre fichier
      </button>

      {committed.length > 0 && (
        <p className="text-[11.5px] text-fg-subtle">
          {allFiles.length} pièce{allFiles.length > 1 ? 's' : ''} sur ce dépôt
          {draft ? ' (dont la capture en cours)' : ''}.
        </p>
      )}
    </div>
  );
}
