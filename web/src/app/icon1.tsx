import { ImageResponse } from 'next/og';

// Icône large 512×512 — utilisée dans le manifest PWA pour les
// devices haute-résolution et les écrans d'install Android. Même
// rendu que `icon.tsx`, juste plus grande.

export const size = { width: 512, height: 512 };
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
          backgroundImage: 'linear-gradient(135deg, #1a3a6c 0%, #001a33 100%)',
          fontSize: 350,
          color: 'white',
        }}
      >
        🐻
      </div>
    ),
    { ...size },
  );
}
