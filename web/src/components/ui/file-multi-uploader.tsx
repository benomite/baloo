'use client';

import { useEffect, useRef, useState } from 'react';

interface FileItem {
  id: number;
  file: File;
  previewUrl?: string;
}

interface Props {
  name: string;
  required?: boolean;
  accept?: string;
  helpText?: string;
}

let _seq = 0;

export function FileMultiUploader({
  name,
  required = false,
  accept = 'image/*,application/pdf',
  helpText,
}: Props) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const realInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);

  // Synchronise l'input file natif (caché) avec notre liste interne :
  // c'est lui qui sera embarqué dans le FormData au submit du <form>.
  useEffect(() => {
    if (!realInputRef.current) return;
    const dt = new DataTransfer();
    for (const it of items) dt.items.add(it.file);
    realInputRef.current.files = dt.files;
  }, [items]);

  // Cleanup des object URLs quand le component démonte ou que les items changent.
  useEffect(() => {
    return () => {
      for (const it of items) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = (fileList: FileList | null | undefined) => {
    if (!fileList || fileList.length === 0) return;
    const newOnes: FileItem[] = [];
    for (const file of Array.from(fileList)) {
      // Filtre minimal pour éviter les doublons exacts (même nom + taille).
      const dup = items.some((it) => it.file.name === file.name && it.file.size === file.size);
      if (dup) continue;
      newOnes.push({
        id: ++_seq,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      });
    }
    if (newOnes.length > 0) setItems((prev) => [...prev, ...newOnes]);
  };

  const removeItem = (id: number) => {
    setItems((prev) => {
      const found = prev.find((it) => it.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer?.files);
  };

  const totalSize = items.reduce((s, it) => s + it.file.size, 0);
  const sizeLabel = totalSize > 1024 * 1024
    ? `${(totalSize / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.round(totalSize / 1024)} Ko`;

  return (
    <div className="space-y-3">
      <input
        ref={realInputRef}
        type="file"
        name={name}
        multiple
        accept={accept}
        required={required && items.length === 0}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />
      {/* Inputs invisibles qui ouvrent le picker / la caméra. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-lg border-2 border-dashed p-4 text-sm transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 bg-muted/20'
        }`}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="text-2xl" aria-hidden>📎</div>
          <div className="text-muted-foreground">
            <span className="hidden sm:inline">Glisse tes fichiers ici, ou </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              parcourir
            </button>
            <span className="mx-1 text-muted-foreground/60">·</span>
            <button
              type="button"
              onClick={() => captureInputRef.current?.click()}
              className="text-primary underline underline-offset-2 hover:no-underline"
            >
              prendre une photo
            </button>
          </div>
          {helpText && <p className="text-xs text-muted-foreground/70">{helpText}</p>}
        </div>
      </div>

      {items.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs text-muted-foreground px-1">
            <span>{items.length} fichier{items.length > 1 ? 's' : ''}</span>
            <span>{sizeLabel}</span>
          </div>
          <ul className="border rounded divide-y">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                {it.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.previewUrl}
                    alt=""
                    className="h-10 w-10 object-cover rounded border"
                  />
                ) : (
                  <div className="h-10 w-10 flex items-center justify-center bg-muted rounded border text-lg">
                    📄
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{it.file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {it.file.size > 1024 * 1024
                      ? `${(it.file.size / (1024 * 1024)).toFixed(1)} Mo`
                      : `${Math.round(it.file.size / 1024)} Ko`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  className="text-muted-foreground hover:text-destructive text-sm px-2"
                  aria-label="Retirer ce fichier"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
