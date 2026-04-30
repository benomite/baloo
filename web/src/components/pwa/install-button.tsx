'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

// `<InstallButton>` : bouton qui propose d'installer Baloo en PWA.
// Chrome / Edge / Firefox récents émettent un event `beforeinstallprompt`
// quand l'app est éligible à l'install. On capture cet event et on le
// déclenche au tap user.
//
// Affichage conditionnel :
//   - Caché par défaut (l'event n'est pas encore tiré, ou app déjà
//     installée, ou navigateur non compatible — Safari iOS notamment).
//   - Apparaît dès que l'event est tiré.
//   - Disparaît une fois l'app installée.
//
// À placer dans `/moi` ou la sidebar mobile pour rester accessible.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Détection : déjà installée (display-mode standalone).
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !promptEvent) return null;

  const onClick = async () => {
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        setPromptEvent(null);
      }
    } catch (err) {
      console.warn('[baloo-pwa] install prompt error:', err);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Download size={14} strokeWidth={2} className="mr-1.5" />
      Installer Baloo
    </Button>
  );
}
