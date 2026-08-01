import type { ReactNode } from "react";

/**
 * Desktop letterbox: centers a ~9:19.5 phone stage so the game always reads
 * as a portrait mobile product (X in-app browser vibe). Full-bleed on narrow
 * viewports.
 */
export function PhoneShell({ children }: { children: ReactNode }) {
  return (
    <div className="phone-shell-outer flex min-h-dvh w-full items-center justify-center bg-bg">
      <div className="phone-shell-stage relative h-dvh w-full max-w-none overflow-hidden bg-bg sm:h-[min(100dvh,920px)] sm:w-[min(100vw-2rem,430px)] sm:max-h-[min(100dvh-1.5rem,920px)] sm:rounded-[1.75rem] sm:border sm:border-border sm:shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_25px_80px_-20px_rgba(0,0,0,0.75)]">
        {/* subtle top speaker / status bar nod on desktop frame */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-50 hidden h-6 items-center justify-center sm:flex"
          aria-hidden
        >
          <div className="mt-2 h-1 w-16 rounded-full bg-fg/15" />
        </div>
        <div className="absolute inset-0 overflow-hidden sm:pt-1">{children}</div>
      </div>
    </div>
  );
}
