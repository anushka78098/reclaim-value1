import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

export function Button({ variant = 'primary', size = 'md', className = '', busy, children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-base' };
  const variants = {
    primary: 'bg-verdigris-600 text-white hover:bg-verdigris-700',
    secondary: 'border border-slab-400 bg-white text-graphite-900 hover:bg-slab-200',
    ghost: 'text-verdigris-700 hover:bg-verdigris-50',
    danger: 'border border-brick-500 bg-white text-brick-600 hover:bg-brick-50',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-graphite-800">{label}</label>
      {child}
      {hint && !error && <p className="mt-1 text-xs text-graphite-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-brick-600">{error}</p>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-graphite-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-verdigris-600 border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="rounded-lg border border-dashed border-slab-400 px-6 py-10 text-center">
      <p className="font-semibold text-graphite-800">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-graphite-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <p role="alert" className="rounded-md border border-brick-500/40 bg-brick-50 px-3 py-2 text-sm text-brick-600">{children}</p>;
}

const STATUS_STYLES = {
  active: 'bg-verdigris-50 text-verdigris-700 border-verdigris-300',
  inventory: 'bg-slab-200 text-graphite-600 border-slab-400',
  listed: 'bg-verdigris-50 text-verdigris-700 border-verdigris-300',
  pending: 'bg-tag-300/40 text-graphite-800 border-tag-400',
  accepted: 'bg-verdigris-50 text-verdigris-700 border-verdigris-300',
  reserved: 'bg-tag-300/40 text-graphite-800 border-tag-400',
  completed: 'bg-verdigris-600 text-white border-verdigris-600',
  sold: 'bg-verdigris-600 text-white border-verdigris-600',
  reused: 'bg-verdigris-600 text-white border-verdigris-600',
  recycled: 'bg-verdigris-100 text-verdigris-800 border-verdigris-300',
  rejected: 'bg-white text-graphite-500 border-slab-400',
  cancelled: 'bg-white text-graphite-500 border-slab-400',
  withdrawn: 'bg-white text-graphite-500 border-slab-400',
  disposed: 'bg-white text-brick-600 border-brick-500/40',
  open: 'bg-tag-300/40 text-graphite-800 border-tag-400',
  under_review: 'bg-verdigris-50 text-verdigris-700 border-verdigris-300',
  resolved: 'bg-verdigris-600 text-white border-verdigris-600',
};
const STATUS_TEXT = { inventory: 'In inventory', under_review: 'Under review' };

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status] || STATUS_STYLES.inventory}`}>
      {STATUS_TEXT[status] || status}
    </span>
  );
}

export function PageHeader({ title, children, actions }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {children && <p className="mt-1 max-w-2xl text-graphite-500">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ value, label, note }) {
  return (
    <div className="border-l-2 border-verdigris-600 pl-3">
      <p className="figure text-2xl font-bold leading-tight">{value}</p>
      <p className="text-sm text-graphite-600">{label}</p>
      {note && <p className="text-xs text-graphite-400">{note}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-graphite-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 sm:max-w-lg sm:rounded-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-graphite-500 hover:bg-slab-200" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((text, tone = 'ok') => {
    setToast({ text, tone, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
        {toast && (
          <p key={toast.id} className={`pointer-events-auto rounded-md px-4 py-2.5 text-sm font-semibold shadow-lg ${toast.tone === 'error' ? 'bg-brick-600 text-white' : 'bg-graphite-900 text-white'}`}>
            {toast.text}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// Data loader hook: { data, error, loading, reload }
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn().then(
      (data) => setState({ data, error: null, loading: false }),
      (error) => setState({ data: null, error: error.message, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
