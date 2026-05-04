declare module 'jscanify/client' {
  // Interface partielle, suffisante pour nos usages dans lib/scanify.ts.
  // jscanify dépend de window.cv (OpenCV.js) chargé séparément.
  export default class Jscanify {
    findPaperContour(img: unknown): unknown;
    getCornerPoints(
      contour: unknown,
      img: unknown,
    ): {
      topLeftCorner: { x: number; y: number };
      topRightCorner: { x: number; y: number };
      bottomLeftCorner: { x: number; y: number };
      bottomRightCorner: { x: number; y: number };
    };
    extractPaper(
      image: HTMLImageElement,
      width: number,
      height: number,
      cornerPoints?: {
        topLeftCorner: { x: number; y: number };
        topRightCorner: { x: number; y: number };
        bottomLeftCorner: { x: number; y: number };
        bottomRightCorner: { x: number; y: number };
      },
    ): HTMLCanvasElement;
    highlightPaper(image: HTMLImageElement, options?: { color?: string; thickness?: number }): HTMLCanvasElement;
  }
}
