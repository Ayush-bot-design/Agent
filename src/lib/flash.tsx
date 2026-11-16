import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type FlashTone = 'success' | 'error' | 'info';

interface FlashMessage {
  id: number;
  message: string;
  tone: FlashTone;
}

interface FlashContextValue {
  flash: (message: string, tone?: FlashTone) => void;
}

const FlashContext = createContext<FlashContextValue | null>(null);

export function FlashProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<FlashMessage | null>(null);

  const flash = useCallback((text: string, tone: FlashTone = 'info') => {
    const id = Date.now();
    setMessage({ id, message: text, tone });
    window.setTimeout(() => {
      setMessage((current) => (current && current.id === id ? null : current));
    }, 6000);
  }, []);

  const value = useMemo(() => ({ flash }), [flash]);

  return (
    <FlashContext.Provider value={value}>
      {children}
      {message ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:bottom-6">
          <div
            role="status"
            className={[
              'pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1 ring-inset backdrop-blur',
              message.tone === 'success' && 'bg-emerald-600/95 text-white ring-emerald-500',
              message.tone === 'error' && 'bg-rose-600/95 text-white ring-rose-500',
              message.tone === 'info' && 'bg-slate-900/95 text-white ring-slate-700',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {message.message}
          </div>
        </div>
      ) : null}
    </FlashContext.Provider>
  );
}

export function useFlash(): FlashContextValue {
  const context = useContext(FlashContext);
  if (!context) throw new Error('useFlash must be used inside <FlashProvider>.');
  return context;
}
