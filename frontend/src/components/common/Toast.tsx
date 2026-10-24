import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Tone = "ok" | "info";
interface ToastApi {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

/** `const { show } = useToast(); show("Copied")`. One toast at a time, 2s. */
export const useToast = (): ToastApi => useContext(ToastContext);

const SHOW_MS = 2000;
const FADE_MS = 160;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ id: number; message: string; tone: Tone } | null>(null);
  const [open, setOpen] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seq = useRef(0);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const show = useCallback((message: string, tone: Tone = "info") => {
    clear();
    setToast({ id: ++seq.current, message, tone });
    // Mount closed, then open on the next frame so the fade-in runs.
    setOpen(false);
    timers.current.push(setTimeout(() => setOpen(true), 16));
    timers.current.push(setTimeout(() => setOpen(false), SHOW_MS));
    timers.current.push(setTimeout(() => setToast(null), SHOW_MS + FADE_MS));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="zv-toast-host">
        {/* The live region stays mounted so the message is announced when it fills. */}
        <div role="status" aria-live="polite">
          {toast && (
            <div
              key={toast.id}
              className="zv-toast zv-glass"
              data-tone={toast.tone}
              data-open={open}
            >
              {toast.message}
            </div>
          )}
        </div>
      </div>
    </ToastContext.Provider>
  );
};
