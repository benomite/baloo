'use client';

import { Loader2 } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

// Bouton de submit qui affiche un spinner et se désactive pendant
// que l'action serveur tourne. Doit être placé DANS un `<form>`
// (sinon `useFormStatus()` retourne toujours `pending=false`).
//
// API identique au `<Button>` shadcn : passe variant / size / className.
// `type` est forcé à `submit` (sinon le hook n'a pas de sens).
//
// Couvre le manque laissé par `nextjs-toploader` qui ne capte que la
// navigation, pas les form submits.

type ButtonProps = React.ComponentProps<typeof Button>;

interface PendingButtonProps extends Omit<ButtonProps, 'type'> {
  /** Label affiché pendant la requête. Défaut : on garde `children`. */
  pendingLabel?: React.ReactNode;
}

export function PendingButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: PendingButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? (
        <>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={2.25} />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
