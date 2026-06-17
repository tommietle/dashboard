'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

// Toont de sidebar overal behalve op de inlogpagina.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </>
  );
}
