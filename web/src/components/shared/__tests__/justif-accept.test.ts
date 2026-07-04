// Filtrage des fichiers déposés (drag & drop) sur un bloc justificatif :
// on n'accepte que ce que l'input accepte déjà — image/* + application/pdf.

import { describe, it, expect } from 'vitest';
import { acceptJustifFiles } from '../justif-accept';

function file(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('acceptJustifFiles', () => {
  it('garde les images', () => {
    const out = acceptJustifFiles([file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')]);
    expect(out.map((f) => f.name)).toEqual(['a.jpg', 'b.png']);
  });

  it('garde les PDF', () => {
    const out = acceptJustifFiles([file('facture.pdf', 'application/pdf')]);
    expect(out.map((f) => f.name)).toEqual(['facture.pdf']);
  });

  it('rejette les types non pris en charge (docx, xlsx, texte…)', () => {
    const out = acceptJustifFiles([
      file('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      file('notes.txt', 'text/plain'),
    ]);
    expect(out).toEqual([]);
  });

  it('accepte un PDF dont le type MIME est vide mais l\'extension .pdf (glisser depuis certains OS)', () => {
    const out = acceptJustifFiles([file('scan.pdf', '')]);
    expect(out.map((f) => f.name)).toEqual(['scan.pdf']);
  });

  it('accepte une image dont le type est vide mais l\'extension connue', () => {
    const out = acceptJustifFiles([file('photo.JPG', ''), file('img.heic', '')]);
    expect(out.map((f) => f.name)).toEqual(['photo.JPG', 'img.heic']);
  });

  it('rejette un fichier sans type ET sans extension reconnue', () => {
    const out = acceptJustifFiles([file('inconnu', '')]);
    expect(out).toEqual([]);
  });

  it('conserve l\'ordre et filtre le mélange', () => {
    const out = acceptJustifFiles([
      file('1.png', 'image/png'),
      file('2.txt', 'text/plain'),
      file('3.pdf', 'application/pdf'),
    ]);
    expect(out.map((f) => f.name)).toEqual(['1.png', '3.pdf']);
  });

  it('liste vide → vide', () => {
    expect(acceptJustifFiles([])).toEqual([]);
  });
});
