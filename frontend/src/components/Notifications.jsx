import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ago } from '../api';

const POLL_MS = 30000;

// Bell with unread count. Polls every 30 s and when the tab regains focus.
export default function Notifications({ dark = false }) {
  const navigate = useNavigate();
  const [data, setData] = useState({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  const load = useCallback(() => api('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    window.addEventListener('focus', load);
    return () => { clearInterval(t); window.removeEventListener('focus', load); };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function openItem(n) {
    setOpen(false);
    if (!n.read) {
      setData((d) => ({ unread: Math.max(0, d.unread - 1), items: d.items.map((x) => (x._id === n._id ? { ...x, read: true } : x)) }));
      api(`/notifications/${n._id}/read`, { method: 'PATCH' }).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    setData((d) => ({ unread: 0, items: d.items.map((x) => ({ ...x, read: true })) }));
    api('/notifications/read-all', { method: 'POST' }).catch(() => {});
  }

  const label = data.unread ? `Notifications, ${data.unread} unread` : 'Notifications';
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className={`relative rounded-md p-2 ${dark ? 'text-verdigris-50/80 hover:bg-verdigris-700/60 hover:text-white' : 'text-graphite-600 hover:bg-slab-200'}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9zM10 20.5a2.2 2.2 0 0 0 4 0" />
        </svg>
        {data.unread > 0 && (
          <span className="figure absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-tag-400 px-1 text-[11px] font-bold text-graphite-900">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slab-300 bg-white text-graphite-900 shadow-xl md:left-0 md:right-auto">
          <div className="flex items-center justify-between border-b border-slab-300 px-4 py-2.5">
            <p className="font-semibold">Notifications</p>
            {data.unread > 0 && <button onClick={readAll} className="text-sm font-semibold text-verdigris-700 hover:underline">Mark all read</button>}
          </div>
          {!data.items.length ? (
            <p className="px-4 py-6 text-sm text-graphite-500">Nothing yet. Wanted alert matches, buyer demand and dispute updates show up here.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {data.items.map((n) => (
                <li key={n._id}>
                  <button onClick={() => openItem(n)} className={`block w-full border-b border-slab-200 px-4 py-3 text-left hover:bg-slab-100 ${n.read ? '' : 'bg-verdigris-50'}`}>
                    <p className="flex items-start gap-2 text-sm font-semibold">
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-verdigris-600" aria-label="Unread" />}
                      {n.title}
                    </p>
                    {n.body && <p className="mt-0.5 text-sm text-graphite-600">{n.body}</p>}
                    <p className="mt-1 text-xs text-graphite-400">{ago(n.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
