import { ImageResponse } from 'next/og';

// OG image par défaut du site, servie automatiquement sur /opengraph-image
// + injectée dans les meta og:image / twitter:image. Cf. metadataBase dans
// app/layout.tsx pour la résolution URL absolue.

export const runtime = 'edge';
export const alt = 'Baloo — Le carnet du trésorier SGDF';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: 'linear-gradient(135deg, #1a3a6c 0%, #001a33 100%)',
          color: 'white',
          padding: 80,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 140, marginBottom: 24 }}>🐻</div>
        <div
          style={{
            display: 'flex',
            fontSize: 84,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1,
            marginBottom: 20,
          }}
        >
          Baloo
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            fontWeight: 400,
            opacity: 0.9,
            textAlign: 'center',
            maxWidth: 900,
          }}
        >
          Le carnet du trésorier d&apos;un groupe SGDF
        </div>
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: 56,
            fontSize: 24,
            opacity: 0.7,
          }}
        >
          baloo.benomite.com · Open source · MIT
        </div>
      </div>
    ),
    { ...size },
  );
}
