'use client';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { UploadCloud, Paperclip, X } from 'lucide-react';
import { uploadJustificatif } from '@/lib/actions/justificatifs';
import { acceptJustifFiles } from '@/components/shared/justif-accept';

// Zone de dépôt COMPACTE d'un justificatif sur une écriture : une barre fine
// dashed cliquable + drag & drop. Choisir/déposer un fichier affiche son nom ;
// « Ajouter » l'envoie (server action). Remplace l'ancien input file brut qui
// prenait beaucoup de place.

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[12px] font-medium text-brand-fg hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Envoi…' : 'Ajouter'}
    </button>
  );
}

export function JustifUploadZone({ entityId }: { entityId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState<string | null>(null);

  const setFromFile = (f: File | undefined) => {
    if (f) setName(f.name);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const accepted = acceptJustifFiles(Array.from(e.dataTransfer.files));
    if (accepted[0] && inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(accepted[0]);
      inputRef.current.files = dt.files;
      setName(accepted[0].name);
    }
  };

  const clear = () => {
    setName(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <form action={uploadJustificatif}>
      <input type="hidden" name="entity_type" value="ecriture" />
      <input type="hidden" name="entity_id" value={entityId} />
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => setFromFile(e.target.files?.[0])}
      />
      {name ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
          <Paperclip size={13} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <button type="button" onClick={clear} aria-label="Retirer" className="shrink-0 text-fg-subtle hover:text-fg">
            <X size={14} />
          </button>
          <AddButton />
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
