'use client';

import { useState } from 'react';
import { MobileNav } from './mobile-nav';
import { BottomNav } from './bottom-nav';

export function MobileShell({ role, children }: { role: string; children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <MobileNav open={drawerOpen} onOpenChange={setDrawerOpen}>
        {children}
      </MobileNav>
      <BottomNav role={role} onOpenMore={() => setDrawerOpen(true)} />
    </>
  );
}
