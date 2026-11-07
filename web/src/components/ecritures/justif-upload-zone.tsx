'use client';

import { useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { UploadCloud, Paperclip, X } from 'lucide-react';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { acceptJustifFiles } from '@/components/shared/justif-accept';
import { UploadedJustifInputs, useJustifUploads } from '@/components/shared/use-justif-uploads';

// Zone de dépôt COMPACTE d'un justificatif sur une écriture : une barre fine
// dashed cliquable + drag & drop. Choisir/déposer un fichier l'envoie
// aussitôt au storage (téléversement direct, ticket #28) et affiche son
// nom ; « Ajouter » le rattache à l'écriture (server action).

function AddButton({ uploading }: { uploading: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || uploading}
      className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[12px] font-medium text-brand-fg hover:opacity-90 disabled:opacity-60"
    >
      {uploading ? 'Envoi…' : pending ? 'Ajout…' : 'Ajouter'}
    </button>
  );
}

export function JustifUploadZone({
  entityId,
  entityType = 'ecriture',
}: {
  entityId: string;
  entityType?: 'ecriture' | 'remboursement';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const files = useMemo(() => (file ? [file] : []), [file]);
  const uploads = useJustifUploads(files);
  const st = file ? uploads.stateOf(file) : undefined;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const accepted = acceptJustifFiles(Array.from(e.dataTransfer.files));
    if (accepted[0]) setFile(accepted[0]);
  };

  const clear = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <form
      action={async (fd) => {
        await uploadJustificatif(fd);
        // Le téléversement est rattaché : il ne peut plus resservir.
        clear();
      }}
    >
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <UploadedJustifInputs name="file" uploads={uploads} required />
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
          <Paperclip size={13} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate">
            {file.name}
            {st?.status === 'error' && <span className="ml-2 text-destructive">{st.message}</span>}
          </span>
          <button type="button" onClick={clear} aria-label="Retirer" className="shrink-0 text-fg-subtle hover:text-fg">
            <X size={14} />
          </button>
          <AddButton uploading={uploads.pending} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          className={`w-full flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-[12.5px] transition-colors ${
            drag ? 'border-brand bg-brand-50/40 text-brand' : 'border-border text-fg-muted hover:border-brand hover:text-brand'
          }`}
        >
          <UploadCloud size={16} className="shrink-0" />
          <span className="font-medium">Glisse un justif ici, ou <span className="underline decoration-dotted">choisis un fichier</span></span>
          <span className="ml-auto text-[11px] text-fg-subtle">photo · PDF · scan</span>
        </button>
      )}
    </form>
  );
}
