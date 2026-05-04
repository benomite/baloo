// Helpers pour la détection de bords et le crop perspective d'un
// document scanné, basés sur jscanify (lui-même basé sur OpenCV.js).
//
// OpenCV.js fait ~9 Mo. Il est chargé à la demande depuis le CDN
// docs.opencv.org au moment où l'utilisateur déclenche la détection,
// pas dans le bundle initial. jscanify est lazy-importé via le sous-
// chemin `jscanify/client` (le `main` du package est la version Node
// qui dépend de jsdom + canvas, qu'on ne veut pas côté navigateur).
//
// Cette dépendance externe est un compromis assumé (cf. ADR-028) :
// éviter de stocker 9 Mo de binaire OpenCV dans /public.

const OPENCV_CDN = 'https://docs.opencv.org/4.7.0/opencv.js';

declare global {
  interface Window {
    cv?: {
      onRuntimeInitialized?: () => void;
      Mat?: unknown;
      [k: string]: unknown;
    };
  }
}

let opencvPromise: Promise<void> | null = null;
let scannerPromise: Promise<unknown> | null = null;

export interface CornerPoints {
  topLeftCorner: { x: number; y: number };
  topRightCorner: { x: number; y: number };
  bottomLeftCorner: { x: number; y: number };
  bottomRightCorner: { x: number; y: number };
}

export interface DetectionResult {
  corners: CornerPoints;
  naturalWidth: number;
  naturalHeight: number;
}

function loadOpenCv(): Promise<void> {
  if (opencvPromise) return opencvPromise;
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('OpenCV ne se charge que côté navigateur.'));
  }
  if (window.cv?.Mat) return Promise.resolve();
  opencvPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = OPENCV_CDN;
    script.async = true;
    script.onerror = () => {
      opencvPromise = null;
      reject(new Error('Impossible de charger OpenCV (vérifie ta connexion).'));
    };
    script.onload = () => {
      const cv = window.cv;
      if (!cv) {
        opencvPromise = null;
        return reject(new Error('OpenCV chargé mais introuvable sur window.cv.'));
      }
      // Selon les versions, cv est utilisable directement ou il faut
      // attendre l'event "runtime initialized".
      if (cv.Mat) return resolve();
      cv.onRuntimeInitialized = () => resolve();
    };
    document.head.appendChild(script);
  });
  return opencvPromise;
}

async function getScanner(): Promise<{ instance: unknown; cv: NonNullable<Window['cv']> }> {
  await loadOpenCv();
  if (!scannerPromise) {
    scannerPromise = import('jscanify/client').then((m) => {
      const Ctor = (m as { default: new () => unknown }).default;
      return new Ctor();
    });
  }
  const instance = await scannerPromise;
  return { instance, cv: window.cv! };
}

// Charge le fichier dans un HTMLImageElement (nécessaire pour cv.imread).
async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image illisible.'));
      el.src = url;
    });
    return img;
  } finally {
    // L'objectURL reste valide tant que `img` est vivant.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export async function detectPaperCorners(file: File): Promise<DetectionResult | null> {
  const { instance, cv } = await getScanner();
  const img = await loadImage(file);
  const cvAny = cv as unknown as Record<string, (...args: unknown[]) => unknown>;
  const mat = cvAny.imread(img);
  try {
    const scanner = instance as {
      findPaperContour: (m: unknown) => unknown;
      getCornerPoints: (c: unknown, m: unknown) => CornerPoints;
    };
    const contour = scanner.findPaperContour(mat);
    if (!contour) return null;
    const corners = scanner.getCornerPoints(contour, mat);
    if (
      !corners.topLeftCorner ||
      !corners.topRightCorner ||
      !corners.bottomLeftCorner ||
      !corners.bottomRightCorner
    ) {
      return null;
    }
    return {
      corners,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  } finally {
    (mat as { delete: () => void }).delete();
  }
}

// Applique la transformation perspective avec les corners donnés (qui
// peuvent avoir été ajustés à la main par l'utilisateur).
export async function extractPaper(
  file: File,
  corners: CornerPoints,
): Promise<Blob> {
  const { instance } = await getScanner();
  const img = await loadImage(file);
  const w = Math.round(
    Math.max(
      distance(corners.topLeftCorner, corners.topRightCorner),
      distance(corners.bottomLeftCorner, corners.bottomRightCorner),
    ),
  );
  const h = Math.round(
    Math.max(
      distance(corners.topLeftCorner, corners.bottomLeftCorner),
      distance(corners.topRightCorner, corners.bottomRightCorner),
    ),
  );
  const scanner = instance as {
    extractPaper: (
      i: HTMLImageElement,
      w: number,
      h: number,
      c: CornerPoints,
    ) => HTMLCanvasElement;
  };
  const canvas = scanner.extractPaper(img, w, h, corners);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Conversion canvas → Blob échouée.'))),
      'image/jpeg',
      0.92,
    );
  });
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
