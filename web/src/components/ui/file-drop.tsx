'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { File, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MAX_FILE_SIZE_LABEL, validateClientFile } from '@/lib/justif-allowed';
import { UploadedJustifInputs, useJustifUploads } from '@/components/shared/use-justif-uploads';

// `<FileDrop>` : zone d'upload avec drag & drop + preview du fichier
// sélectionné. Remplace le `<input type="file">` natif (qui rend le
// hideux "Browse… No file selected").
//
// Le fichier part AUSSITÔT vers le storage (téléversement direct, ticket
// #28) ; le formulaire parent ne soumet qu'une référence sous `name`.
//
// Mode unique (par défaut) : 1 fichier. Pour plusieurs fichiers,
// utilise `<FileMultiUploader>`.

interface FileDropProps {
  name: string;
  accept?: string;
  required?: boolean;
  /** Texte additionnel en bas (ex: "PDF, JPG, PNG"). La taille max est ajoutée. */
  hint?: string;
}

export function FileDrop({ name, accept, required, hint }: FileDropProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const files = useMemo(() => (file ? [file] : []), [file]);
  const uploads = useJustifUploads(files);
  const st = file ? uploads.stateOf(file) : undefined;

  const onSelect = (list: FileList | null) => {
    const f = list?.[0] ?? null;
    if (inputRef.current) inputRef.current.value = '';
    if (!f) return;
    const err = validateClientFile(f);
    setRejected(err);
    if (!err) setFile(f);
  };

  const computedHint = `${hint ? `${hint} · ` : ''}${MAX_FILE_SIZE_LABEL} max`;

  const picker = (
    <input
      ref={inputRef}
      id={id}
      type="file"
      accept={accept}
      className="sr-only"
      onChange={(e) => onSelect(e.target.files)}
    />
  );

  return (
    <div className="space-y-1.5">
      <UploadedJustifInputs name={name} uploads={uploads} required={required} />
      {file ? (
        <div className="rounded-lg border border-border bg-bg-elevated px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-brand-50 text-brand flex items-center justify-center shrink-0">
            <File size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-fg truncate">{file.name}</div>
            <div className="text-[11.5px] text-fg-muted">
              {file.size > 1024 * 1024
                ? `${(file.size / (1024 * 1024)).toFixed(1)} Mo`
                : `${(file.size / 1024).toFixed(0)} Ko`}
              {' · '}
              {st?.status === 'done' ? (
                'envoyé'
              ) : st?.status === 'error' ? (
                <span className="text-destructive">{st.message}</span>
              ) : (
                `envoi… ${st?.status === 'uploading' ? `${st.progress} %` : ''}`
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="text-fg-subtle hover:text-destructive transition-colors p-1 rounded-md hover:bg-destructive/10"
            aria-label="Retirer le fichier"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      ) : (
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
            onSelect(e.dataTransfer.files);
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
          <div className="text-[11.5px] text-fg-muted">{computedHint}</div>
          {picker}
        </label>
      )}
      {rejected && <p className="text-xs text-destructive">{rejected}</p>}
    </div>
  );
}
