import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button } from './ui';

const SOURCE = { tool: 'From your live data', gemini: 'Gemini', guide: 'Built-in guide' };

// Renders the assistant's light markdown: **bold** and line breaks.
function Rich({ text }) {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (part.startsWith('**') && part.endsWith('**')
        ? <strong key={j}>{part.slice(2, -2)}</strong>
        : <Fragment key={j}>{part}</Fragment>))}
    </Fragment>
  ));
}

export default function Chat({ suggestions = [], compact = false }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const end = useRef(null);
  const first = useRef(true);
  const owner = useRef(user._id);
  owner.current = user._id;

  // The conversation is stored on the server against this account. Start from an
  // empty state and load only this user's own messages; a different account never
  // inherits what was on screen before.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoading(true);
    api('/ai/agent/history')
      .then((r) => { if (!cancelled) setMessages(r.messages.map(({ role, text: t, source }) => ({ role, text: t, source }))); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user._id]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  async function send(message) {
    const m = message.trim();
    if (!m || busy) return;
    const me = user._id;
    setMessages((ms) => [...ms, { role: 'user', text: m }]);
    setText('');
    setBusy(true);
    let reply;
    try {
      const r = await api('/ai/agent', { method: 'POST', body: { message: m } });
      reply = { role: 'assistant', text: r.reply, source: r.source };
    } catch (err) {
      reply = { role: 'assistant', text: err.message, source: 'error' };
    }
    if (owner.current === me) { // ignore a late answer if the account changed meanwhile
      setMessages((ms) => [...ms, reply]);
      setBusy(false);
    }
  }

  async function clear() {
    try {
      await api('/ai/agent/history', { method: 'DELETE' });
      setMessages([]);
    } catch { /* keep the history if the server could not clear it */ }
  }

  return (
    <div className="panel flex flex-col">
      <div className={`space-y-3 overflow-y-auto p-4 ${compact ? 'max-h-80' : 'max-h-[60vh] min-h-[16rem]'}`} aria-live="polite">
        {loading && <p className="text-sm text-graphite-400">Loading your conversation…</p>}
        {!loading && !messages.length && (
          <p className="text-sm text-graphite-500">
            Ask about your inventory, prices, requests or impact, or how anything in Reclaim Value works.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user'
              ? 'bg-verdigris-600 text-white'
              : m.source === 'error' ? 'bg-brick-50 text-brick-600' : 'bg-slab-100 text-graphite-900'}`}
            >
              <Rich text={m.text} />
              {m.role === 'assistant' && SOURCE[m.source] && (
                <p className="mt-1 text-[11px] text-graphite-400">{SOURCE[m.source]}</p>
              )}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm text-graphite-400">Thinking…</p>}
        <div ref={end} />
      </div>
      {!!suggestions.length && (
        <div className="flex flex-wrap gap-2 border-t border-slab-200 px-4 py-3">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-slab-400 px-3 py-1 text-xs font-semibold text-graphite-600 hover:border-verdigris-600 hover:text-verdigris-700">
              {s}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex gap-2 border-t border-slab-200 p-3">
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <input id="chat-input" className="field" placeholder="Ask something…" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <Button type="submit" disabled={!text.trim()} busy={busy}>Send</Button>
        {!!messages.length && (
          <Button type="button" variant="ghost" onClick={clear} title="Clear conversation">Clear</Button>
        )}
      </form>
    </div>
  );
}
