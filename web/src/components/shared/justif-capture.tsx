'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Camera,
  Check,
  Crop,
  Image as ImageIcon,
  RotateCcw,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  detectPaperCorners,
  extractPaper,
  type CornerPoints,
} from '@/lib/scanify';

// JustifCapture : workflow de capture d'un justificatif optimisé pour
// le mobile.
//
// Niveau 1 (toujours actif) :
//   - bouton "Prendre une photo" / "Choisir un fichier"
//   - preview immédiat
//   - filtre Couleur / Document / Noir & blanc via canvas 2D
//   - resize max 2000 px + JPEG q=0.85 → upload léger
//
// Niveau 2 (à la demande, charge ~9 Mo d'OpenCV.js) :
//   - bouton "Détecter le document" → jscanify trouve les 4 coins
//   - mode crop : poignées SVG draggables pour ajuster les coins
//   - "Appliquer" → transformation perspective → image rectifiée
//
// Niveau 3 (futur, voir doc/decisions.md ADR-028) :
//   - OCR + pré-remplissage automatique du formulaire
//
// Le hidden <input type="file"> est mis à jour via DataTransfer pour
// rester compatible avec les server actions Next 16.

type Filter = 'color' | 'document' | 'bw';
type Mode = 'idle' | 'cropping';
type CornerKey = keyof CornerPoints;

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
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [filter, setFilter] = useState<Filter>('document');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [corners, setCorners] = useState<CornerPoints | null>(null);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const isPdf = rawFile?.type === 'application/pdf';

  // Source pour le pipeline filtre : le crop si appliqué, sinon le
  // fichier brut. On garde le rawFile.name comme libellé du résultat.
  const sourceBlob: Blob | null = croppedBlob ?? rawFile;

  // Object URLs avec cleanup.
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

  // Pipeline filtre + sync hidden input.
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
    if (!sourceBlob) return;
    let cancelled = false;
    processImage(sourceBlob, filter)
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
  }, [rawFile, sourceBlob, filter, isPdf]);

  const reset = () => {
    setRawFile(null);
    setCroppedBlob(null);
    setProcessedBlob(null);
    setBusy(false);
    setMode('idle');
    setCorners(null);
    setNaturalDims(null);
    setScanError(null);
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
    setCroppedBlob(null);
    setMode('idle');
    setCorners(null);
    setScanError(null);
    if (f.type !== 'application/pdf') setBusy(true);
    setRawFile(f);
  };

  const startCrop = async () => {
    if (!rawFile || isPdf) return;
    setBusy(true);
    setScanError(null);
    try {
      const result = await detectPaperCorners(rawFile);
      if (!result) {
        // Document non détecté → coins par défaut au quart / trois quarts
        // pour que l'utilisateur puisse quand même ajuster.
        const img = await loadImageDims(rawFile);
        const fallback = defaultCorners(img.w, img.h);
        setCorners(fallback);
        setNaturalDims({ w: img.w, h: img.h });
        setScanError('Document non détecté automatiquement. Place les coins à la main.');
      } else {
        setCorners(result.corners);
        setNaturalDims({ w: result.naturalWidth, h: result.naturalHeight });
      }
      setMode('cropping');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applyCrop = async () => {
    if (!rawFile || !corners) return;
    setBusy(true);
    setScanError(null);
    try {
      const blob = await extractPaper(rawFile, corners);
      setCroppedBlob(blob);
      setMode('idle');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const cancelCrop = () => {
    setMode('idle');
    setCorners(null);
    setScanError(null);
  };

  const removeCrop = () => {
    setCroppedBlob(null);
    setBusy(true);
  };

  return (
    <div className="space-y-3">
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

      {rawFile && !isPdf && mode === 'cropping' && corners && naturalDims && rawUrl && (
        <CornersEditor
          imageUrl={rawUrl}
          natural={naturalDims}
          corners={corners}
          onChange={setCorners}
          onApply={applyCrop}
          onCancel={cancelCrop}
          busy={busy}
          error={scanError}
        />
      )}

      {rawFile && !isPdf && mode === 'idle' && (
        <>
          <div className="relative overflow-hidden rounded-lg border border-border-soft bg-bg-sunken">
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
            {croppedBlob && (
              <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-brand text-white px-2.5 py-1 text-[11px] font-medium shadow-sm">
                <Crop size={11} strokeWidth={2} />
                Recadré
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
            <div className="ml-auto flex items-center gap-3">
              {!croppedBlob ? (
                <button
                  type="button"
                  onClick={startCrop}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline underline-offset-2 disabled:opacity-50"
                >
                  <Crop size={13} strokeWidth={1.75} />
                  Détecter le document
                </button>
              ) : (
                <button
                  type="button"
                  onClick={removeCrop}
                  className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg"
                >
                  <X size={13} strokeWidth={1.75} />
                  Annuler le recadrage
                </button>
              )}
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 text-[12.5px] text-fg-muted hover:text-fg"
              >
                <RotateCcw size={13} strokeWidth={1.75} />
                Reprendre
              </button>
            </div>
          </div>

          {scanError && mode === 'idle' && (
            <p className="text-[11.5px] text-amber-700">{scanError}</p>
          )}
        </>
      )}
    </div>
  );
}

function CornersEditor({
  imageUrl,
  natural,
  corners,
  onChange,
  onApply,
  onCancel,
  busy,
  error,
}: {
  imageUrl: string;
  natural: { w: number; h: number };
  corners: CornerPoints;
  onChange: (c: CornerPoints) => void;
  onApply: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<CornerKey | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!dragging || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * natural.w;
      const y = ((e.clientY - rect.top) / rect.height) * natural.h;
      onChange({
        ...corners,
        [dragging]: {
          x: clamp(x, 0, natural.w),
          y: clamp(y, 0, natural.h),
        },
      });
    },
    [dragging, natural, corners, onChange],
  );

  const stopDrag = useCallback(() => setDragging(null), []);

  const polygonPoints = [
    corners.topLeftCorner,
    corners.topRightCorner,
    corners.bottomRightCorner,
    corners.bottomLeftCorner,
  ]
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  // Taille des poignées indépendante du zoom de l'image (en unités SVG).
  const handleR = Math.max(natural.w, natural.h) * 0.025;

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-border-soft bg-bg-sunken touch-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Document à détourer"
          className={cn('w-full max-h-[60vh] object-contain', busy && 'opacity-60')}
        />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${natural.w} ${natural.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          onPointerMove={onPointerMove}
          onPointerUp={stopDrag}
          onPointerLeave={stopDrag}
          onPointerCancel={stopDrag}
        >
          <polygon
            points={polygonPoints}
            fill="rgba(20, 80, 160, 0.12)"
            stroke="rgb(20, 80, 160)"
            strokeWidth={Math.max(natural.w, natural.h) * 0.004}
            strokeLinejoin="round"
          />
          {(['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'] as CornerKey[]).map(
            (key) => (
              <CornerHandle
                key={key}
                cx={corners[key].x}
                cy={corners[key].y}
                r={handleR}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDragging(key);
                }}
              />
            ),
          )}
        </svg>
        {busy && (
          <div className="absolute top-2 right-2 rounded-full bg-bg/90 px-2.5 py-1 text-[11px] font-medium text-fg-muted shadow-sm">
            Traitement…
          </div>
        )}
      </div>

      {error && <p className="text-[11.5px] text-amber-700">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11.5px] text-fg-subtle">
          Glisse les coins pour ajuster, puis applique.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-fg-muted hover:text-fg disabled:opacity-50"
          >
            <X size={13} strokeWidth={1.75} />
            Annuler
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand text-white px-3 py-1.5 text-[12.5px] font-medium hover:bg-brand/90 disabled:opacity-50"
          >
            <Check size={13} strokeWidth={2} />
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}

function CornerHandle({
  cx,
  cy,
  r,
  onPointerDown,
}: {
  cx: number;
  cy: number;
  r: number;
  onPointerDown: (e: React.PointerEvent<SVGCircleElement>) => void;
}) {
  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill="rgba(20, 80, 160, 0.25)" />
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.55}
        fill="white"
        stroke="rgb(20, 80, 160)"
        strokeWidth={r * 0.18}
        onPointerDown={onPointerDown}
        style={{ cursor: 'grab' }}
      />
    </>
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
  if (capture) input.setAttribute('capture', capture);
  else input.removeAttribute('capture');
  input.click();
}

function renameToJpg(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function defaultCorners(w: number, h: number): CornerPoints {
  return {
    topLeftCorner: { x: w * 0.1, y: h * 0.1 },
    topRightCorner: { x: w * 0.9, y: h * 0.1 },
    bottomRightCorner: { x: w * 0.9, y: h * 0.9 },
    bottomLeftCorner: { x: w * 0.1, y: h * 0.9 },
  };
}

async function loadImageDims(file: File): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error('Image illisible.'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

async function processImage(file: Blob, filter: Filter): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context indisponible');
  switch (filter) {
    case 'color':
      ctx.filter = 'none';
      break;
    case 'document':
      ctx.filter = 'contrast(1.2) brightness(1.05) saturate(0.85)';
      break;
    case 'bw':
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
