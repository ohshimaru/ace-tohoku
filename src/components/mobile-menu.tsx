"use client";

import { useState, type ReactNode } from "react";

export function MobileMenu({ children, title }: { children: ReactNode; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-md px-3 text-white hover:bg-navy-800" aria-label="メニューを開く" aria-expanded={open}>
        ☰
      </button>
      {open && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="メニューを閉じる" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-navy-900 p-4" onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
