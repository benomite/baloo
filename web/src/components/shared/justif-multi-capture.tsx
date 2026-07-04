'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, UploadCloud } from 'lucide-react';
import { JustifCapture } from './justif-capture';
import { acceptJustifFiles } from './justif-accept';

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
  const [dragActive, setDragActive] = useState(false);
  const realInputRef = useRef<HTMLInputElement>(null);
  // Compteur d'entrée/sortie de drag : les événements dragenter/dragleave
  // se déclenchent aussi sur les enfants ; on ne repasse « inactif » que
  // lorsque le curseur a vraiment quitté le bloc (compteur revenu à 0).
  const dragDepth = useRef(0);

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

  const pushCommitted = useCallback((f: File) => {
    // Aperçu seulement pour les images réellement affichables par le
    // navigateur (type image/* connu). Un type MIME vide → pas d'aperçu,
    // vignette badge (cf. rendu ci-dessous).
    const previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
    setCommitted((prev) => [...prev, { id: ++_seq, file: f, previewUrl }]);
  }, []);

  const addAnother = () => {
    if (!draft) return;
    pushCommitted(draft);
    setDraft(null);
    setCaptureKey((k) => k + 1); // remonte une capture vierge
  };

  // Fichiers déposés (drag & drop) : ajoutés directement comme pièces,
  // sans passer par le pipeline caméra (recadrage/filtres) — un fichier
  // glissé est déjà finalisé.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const dropped = acceptJustifFiles(Array.from(e.dataTransfer.files));
    for (const f of dropped) pushCommitted(f);
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const removeCommitted = (id: number) => {
    setCommitted((prev) => {
      const found = prev.find((c) => c.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((c) => c.id !== id);
    });
  };

  return (
    <div
      className={`relative space-y-3 rounded-lg transition-colors ${
        dragActive ? 'ring-2 ring-brand ring-offset-2 ring-offset-bg' : ''
      }`}
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-brand bg-brand-50/70 text-brand backdrop-blur-[1px]">
          <UploadCloud size={22} strokeWidth={2} />
          <span className="text-[13px] font-semibold">Déposer les fichiers ici</span>
          <span className="text-[11.5px] font-medium text-brand/80">Photo, PDF ou scan</span>
        </div>
      )}
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
                    {c.file.name.includes('.')
                      ? c.file.name.slice(c.file.name.lastIndexOf('.') + 1).toUpperCase()
                      : 'FICHIER'}
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
