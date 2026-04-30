'use client';

import { useId, useRef, useState } from 'react';
import { File, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// `<FileDrop>` : zone d'upload avec drag & drop + preview du fichier
// sélectionné. Remplace le `<input type="file">` natif (qui rend le
// hideux "Browse… No file selected").
//
// Mode unique (par défaut) : 1 fichier. Pour plusieurs fichiers,
// utilise `<FileMultiUploader>` (existant, dédié aux justifs rembs).

interface FileDropProps {
  name: string;
  accept?: string;
  required?: boolean;
  /** Taille max indicative (affichage seul, vraie validation côté serveur). */
  maxSizeMb?: number;
  /** Texte additionnel en bas (ex: "PDF, JPG, PNG · 10 MB max"). */
  hint?: string;
}

export function FileDrop({ name, accept, required, maxSizeMb, hint }: FileDropProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const onSelect = (files: FileList | null) => {
    if (!files || files.length === 0) {
      setFile(null);
      return;
    }
    setFile(files[0]);
  };

  const computedHint = hint ?? (maxSizeMb ? `Taille max ${maxSizeMb} MB` : undefined);

  if (file) {
    return (
      <div className="rounded-lg border border-border bg-bg-elevated px-4 py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-md bg-brand-50 text-brand flex items-center justify-center shrink-0">
          <File size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-fg truncate">{file.name}</div>
          <div className="text-[11.5px] text-fg-muted">
            {(file.size / 1024).toFixed(0)} KB
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setFile(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
          className="text-fg-subtle hover:text-destructive transition-colors p-1 rounded-md hover:bg-destructive/10"
          aria-label="Retirer le fichier"
        >
          <X size={15} strokeWidth={2} />
        </button>
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          required={required}
          className="sr-only"
          onChange={(e) => onSelect(e.target.files)}
        />
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files && inputRef.current) {
          inputRef.current.files = e.dataTransfer.files;
          onSelect(e.dataTransfer.files);
        }
      }}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-5 py-7 cursor-pointer transition-all',
        dragOver
          ? 'border-brand bg-brand-50'
          : 'border-border-strong bg-bg-sunken hover:border-brand/60 hover:bg-brand-50/40',
      )}
    >
      <Upload size={18} className="text-fg-subtle mb-1" strokeWidth={1.75} />
      <div className="text-[13.5px] text-fg font-medium">
        Dépose un fichier ou{' '}
        <span className="text-brand underline-offset-2 hover:underline">parcours</span>
      </div>
      {computedHint && (
        <div className="text-[11.5px] text-fg-muted">{computedHint}</div>
      )}
      <input
        ref={inputRef}
        id={id}
        type="file"
        name={name}
        accept={accept}
        required={required}
        className="sr-only"
        onChange={(e) => onSelect(e.target.files)}
      />
    </label>
  );
}
