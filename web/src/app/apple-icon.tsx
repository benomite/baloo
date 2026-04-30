import { ImageResponse } from 'next/og';

// Apple Touch Icon 180×180 — utilisée par iOS Safari quand l'utilisateur
// fait "Ajouter à l'écran d'accueil". iOS arrondit l'icône lui-même au
// niveau de l'OS, donc on laisse les coins carrés ici.

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          fontSize: 120,
          color: 'white',
        }}
      >
        🐻
      </div>
    ),
    { ...size },
  );
}
