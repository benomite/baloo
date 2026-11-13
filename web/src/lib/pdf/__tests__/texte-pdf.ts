// Aide de test : tout ce qu'un lecteur peut tirer d'un PDF pdfkit, pour
// prouver qu'une valeur n'y figure pas. pdfkit compresse ses flux
// (FlateDecode) et écrit le texte en chaînes hexadécimales dans des
// tableaux `TJ` coupés par le crénage : chercher l'IBAN dans les octets
// bruts ne prouverait rien. On décompresse donc chaque flux et on décode
// chaque `TJ`. Le résultat est sans espaces, à comparer avec une valeur
// passée par `sansEspaces`.

import { inflateSync } from 'node:zlib';

export function sansEspaces(s: string): string {
  return s.replace(/\s+/g, '');
}

export function contenuLisiblePdf(buf: Buffer): string {
  const raw = buf.toString('latin1');
  const morceaux: string[] = [raw];

  let debut = raw.indexOf('stream');
  while (debut !== -1) {
    const corps = debut + 'stream'.length + (raw[debut + 6] === '\r' ? 2 : 1);
    const fin = raw.indexOf('endstream', corps);
    if (fin === -1) break;
    const octets = buf.subarray(corps, fin);
    let flux: string;
    try {
      flux = inflateSync(octets).toString('latin1');
    } catch {
      flux = octets.toString('latin1');
    }
    morceaux.push(flux);
    for (const tj of flux.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      morceaux.push(
        [...tj[1].matchAll(/<([0-9a-fA-F\s]*)>/g)]
          .map((h) => Buffer.from(sansEspaces(h[1]), 'hex').toString('latin1'))
          .join(''),
      );
    }
    debut = raw.indexOf('stream', fin + 'endstream'.length);
  }
  return sansEspaces(morceaux.join('\n'));
}
