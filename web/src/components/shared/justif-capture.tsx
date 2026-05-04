'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

// JustifCapture : prend la place du <input type="file"> classique pour
// les justificatifs. Workflow :
// 1. l'utilisateur prend une photo (input file natif, capture="environment")
// 2. preview + filtre (Couleur / Document / N&B) appliqué via canvas
// 3. resize au max 2000 px sur le grand côté + JPEG q=0.85
// 4. le hidden <input type="file" name="..."> est mis à jour via
//    DataTransfer pour porter le blob processé vers la server action
//
// Si l'utilisateur upload un PDF, on passe en mode "fichier brut" :
// pas de traitement, juste un récap.
//
// Le niveau 2 (détection de bords + crop perspective) viendra greffer
// une étape supplémentaire entre 1 et 2 via jscanify (chargé à la demande).

type Filter = 'color' | 'document' | 'bw';

const MAX_DIM = 2000;
const JPEG_QUALITY = 0.85;

export function JustifCapture({
  name,
  id,
  required,
}: {
  name: string;
  id?: string;
  required?: boolean;
}) {
  const reactId = useId();
  const inputId = id ?? `justif-${reactId}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [filter, setFilter] = useState<Filter>('document');
  const [busy, setBusy] = useState(false);

  const isPdf = rawFile?.type === 'application/pdf';

  // Object URLs dérivés du fichier / blob courant. Le cleanup se fait
  // au prochain changement (ou démontage) via l'effet ci-dessous.
  const rawUrl = useMemo(
    () => (rawFile ? URL.createObjectURL(rawFile) : null),
    [rawFile],
  );
  const processedUrl = useMemo(
    () => (processedBlob ? URL.createObjectURL(processedBlob) : null),
    [processedBlob],
  );
  useEffect(() => {
    if (!rawUrl) return;
    return () => URL.revokeObjectURL(rawUrl);
  }, [rawUrl]);
  useEffect(() => {
    if (!processedUrl) return;
    return () => URL.revokeObjectURL(processedUrl);
  }, [processedUrl]);

  // Synchronise le hidden file input avec le résultat du traitement.
  // PDF : pass-through, image : re-process à chaque changement de filtre.
  useEffect(() => {
    if (!rawFile) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (isPdf) {
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        dt.items.add(rawFile);
        fileInputRef.current.files = dt.files;
      }
      return;
    }
    let cancelled = false;
    processImage(rawFile, filter)
      .then((blob) => {
        if (cancelled) return;
        const processed = new File([blob], renameToJpg(rawFile.name), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        if (fileInputRef.current) {
          const dt = new DataTransfer();
          dt.items.add(processed);
          fileInputRef.current.files = dt.files;
        }
        setProcessedBlob(blob);
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rawFile, filter, isPdf]);

  const reset = () => {
    setRawFile(null);
    setProcessedBlob(null);
    setBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectFilter = (next: Filter) => {
    if (next === filter) return;
    setBusy(true);
    setFilter(next);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) {
      reset();
      return;
    }
    if (f.type !== 'application/pdf') setBusy(true);
    setRawFile(f);
  };

  return (
    <div className="space-y-3">
      {/* Hidden file input qui porte la valeur soumise au form. */}
      <input
        ref={fileInputRef}
        id={inputId}
        name={name}
        type="file"
        accept="image/*,application/pdf"
        required={required}
        className="sr-only"
        onChange={onPickFile}
      />

      {!rawFile && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <CaptureButton
            icon={<Camera size={16} strokeWidth={1.75} />}
            label="Prendre une photo"
            onClick={() => triggerFilePicker(fileInputRef.current, 'environment')}
          />
          <CaptureButton
            icon={<ImageIcon size={16} strokeWidth={1.75} />}
            label="Choisir un fichier"
            onClick={() => triggerFilePicker(fileInputRef.current, null)}
          />
        </div>
      )}

      {rawFile && isPdf && (
        <div className="rounded-lg border border-border-soft bg-bg-sunken/40 px-3 py-3 flex items-center gap-3">
          <div className="font-mono text-[11px] uppercase tracking-wide rounded px-2 py-1 bg-brand-50 text-brand">
            PDF
          </div>
          <span className="flex-1 truncate text-[13px] font-medium">{rawFile.name}</span>
          <button
            type="button"
            onClick={reset}
            className="text-[12px] text-fg-muted hover:text-fg flex items-center gap-1"
          >
            <RotateCcw size={12} strokeWidth={1.75} />
            Changer
          </button>
        </div>
      )}

      {rawFile && !isPdf && (
        <>
          <div className="relative overflow-hidden rounded-lg border border-border-soft bg-bg-sunken">
            {/* Le aperçu utilise l'image processée si dispo, sinon brute. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={processedUrl ?? rawUrl ?? ''}
              alt="Aperçu du justificatif"
              className={cn(
                'w-full max-h-[60vh] object-contain transition-opacity',
                busy && 'opacity-60',
              )}
            />
            {busy && (
              <div className="absolute top-2 right-2 rounded-full bg-bg/90 px-2.5 py-1 text-[11px] font-medium text-fg-muted shadow-sm">
                Traitement…
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={filter === 'color'} onClick={() => selectFilter('color')}>
              Couleur
            </FilterChip>
            <FilterChip active={filter === 'document'} onClick={() => selectFilter('document')}>
              Document
            </FilterChip>
            <FilterChip active={filter === 'bw'} onClick={() => selectFilter('bw')}>
              Noir &amp; blanc
            </FilterChip>
            <button
              type="button"
              onClick={reset}
              className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg"
            >
              <RotateCcw size={13} strokeWidth={1.75} />
              Reprendre
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CaptureButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 h-12 rounded-lg border border-dashed border-border bg-bg-elevated text-[13.5px] font-medium text-fg hover:border-brand hover:text-brand hover:bg-brand-50/40 transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-brand bg-brand text-white shadow-sm'
          : 'border-border bg-bg-elevated text-fg hover:border-border-strong hover:bg-bg-sunken',
      )}
    >
      {children}
    </button>
  );
}

function triggerFilePicker(
  input: HTMLInputElement | null,
  capture: 'environment' | null,
) {
  if (!input) return;
  // Switch dynamique de l'attribut capture : sur mobile, "environment"
  // ouvre directement la caméra arrière, sans = ouvre le sélecteur
  // (galerie + caméra). Sur desktop, capture est ignoré.
  if (capture) input.setAttribute('capture', capture);
  else input.removeAttribute('capture');
  input.click();
}

function renameToJpg(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

// Charge le fichier image, redimensionne, applique le filtre via canvas
// 2D, retourne un Blob JPEG.
async function processImage(file: File, filter: Filter): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context indisponible');
  // Filtre CSS appliqué pendant le drawImage : geste rapide, hardware
  // accelerated. Plus de finesse plus tard si besoin (Otsu, etc.).
  switch (filter) {
    case 'color':
      ctx.filter = 'none';
      break;
    case 'document':
      // Renforce un peu la lisibilité tout en gardant la couleur.
      ctx.filter = 'contrast(1.2) brightness(1.05) saturate(0.85)';
      break;
    case 'bw':
      // Noir et blanc franc, façon "scan".
      ctx.filter = 'grayscale(1) contrast(2.1) brightness(1.1)';
      break;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob a échoué'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
