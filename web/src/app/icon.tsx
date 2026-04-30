import { ImageResponse } from 'next/og';

// Icône principale 192×192 — utilisée comme favicon + dans le manifest
// PWA. Rendue par Next.js via `next/og` (satori) au build.

export const size = { width: 192, height: 192 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Bleu marine SGDF (~oklch(0.34 0.10 252) en hex équivalent).
          // Légère lumière en haut-gauche pour donner du volume.
          backgroundImage: 'linear-gradient(135deg, #1a3a6c 0%, #001a33 100%)',
          fontSize: 130,
          color: 'white',
        }}
      >
        🐻
      </div>
    ),
    { ...size },
  );
}
