import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ago, inr, kg } from '../api';
import { useAuth } from '../auth';
import {
  CATEGORY_LABEL, HISTORY_LABEL, OUTCOME_LABEL, OUTCOMES, partyName,
} from '../disputes';
import { shrinkPhoto } from '../lib/photo';
import {
  Button, ErrorNote, Field, Spinner, StatusBadge, useLoad, useToast,
} from '../components/ui';

const POLL_MS = 10000;
const OPEN = ['open', 'under_review'];

const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Panel({ title, children, className = '' }) {
  return (
    <section className={`panel p-4 ${className}`}>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Evidence({ dispute, canAdd, onChanged }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      if (file) form.append('photo', await shrinkPhoto(file));
      if (text.trim()) form.append('text', text.trim());
      await api(`/disputes/${dispute._id}/evidence`, { method: 'POST', form });
      setText('');
      setFile(null);
      toast('Evidence added');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`Evidence (${dispute.evidence.length})`}>
      {!dispute.evidence.length && <p className="text-sm text-graphite-500">Nothing added yet. Photos and written statements from both sides appear here.</p>}
      <ul className="space-y-3">
        {dispute.evidence.map((ev) => (
          <li key={ev._id} className="flex gap-3 border-b border-slab-200 pb-3 last:border-0 last:pb-0">
            {ev.kind === 'image' && (
              <a href={ev.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={ev.url} alt={`Evidence from ${ev.name}`} loading="lazy" className="h-24 w-24 rounded-md border border-slab-300 object-cover" />
              </a>
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{ev.name} <span className="font-normal text-graphite-500">({ev.role}) · {ago(ev.createdAt)}</span></p>
              {ev.text && <p className="mt-0.5 whitespace-pre-wrap break-words text-graphite-700">{ev.text}</p>}
              {ev.kind === 'image' && !ev.text && <p className="mt-0.5 text-graphite-500">Photo</p>}
            </div>
          </li>
        ))}
      </ul>
      {canAdd && (
        <form onSubmit={add} className="mt-4 space-y-3 border-t border-slab-200 pt-4">
          <Field label="Add evidence" hint="A photo, a written statement, or both.">
            {(id) => <textarea id={id} className="field min-h-20" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What does this show?" />}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-md border border-slab-400 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slab-200">
              {file ? 'Change photo' : 'Choose photo'}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            {file && <span className="truncate text-sm text-graphite-600">{file.name}</span>}
            <Button type="submit" size="sm" busy={busy} disabled={!file && !text.trim()} className="ml-auto">Add</Button>
          </div>
          <ErrorNote>{error}</ErrorNote>
        </form>
      )}
    </Panel>
  );
}

function Chat({ dispute, me, canPost, onChanged }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef(null);
  const count = dispute.messages.length;
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [count]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/disputes/${dispute._id}/messages`, { method: 'POST', body: { text } });
      setText('');
      onChanged();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Dispute chat">
      <div ref={list} className="max-h-96 space-y-3 overflow-y-auto" aria-live="polite">
        {!count && <p className="text-sm text-graphite-500">No messages yet. Keep it about the trade; the resolver can read everything here.</p>}
        {dispute.messages.map((m) => {
          const mine = String(m.author) === String(me._id);
          const admin = m.role === 'Admin';
          return (
            <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-verdigris-600 text-white' : admin ? 'border border-tag-400 bg-tag-300/40' : 'bg-slab-200'}`}>
                <p className={`text-xs font-semibold ${mine ? 'text-white/80' : 'text-graphite-600'}`}>
                  {mine ? 'You' : admin ? `Resolver, ${m.name}` : m.name} · {when(m.createdAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      {canPost ? (
        <form onSubmit={send} className="mt-3 flex gap-2">
          <label htmlFor="dispute-msg" className="sr-only">Message</label>
          <input id="dispute-msg" className="field" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" />
          <Button type="submit" busy={busy} disabled={!text.trim()}>Send</Button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-graphite-500">This dispute is closed, so the chat is read-only.</p>
      )}
    </Panel>
  );
}

function DecisionForm({ dispute, onChanged }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(e) {
    e.preventDefault();
    const label = OUTCOME_LABEL[outcome];
    if (!window.confirm(`Record "${label}"? Both sides are notified and a decision cannot be changed.`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/disputes/${dispute._id}/decision`, { method: 'POST', body: { outcome, reason } });
      toast('Decision recorded');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={decide} className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Decision</legend>
        <div className="space-y-2">
          {OUTCOMES.map(([v, label, hint]) => (
            <label key={v} className={`block cursor-pointer rounded-md border px-3 py-2 ${outcome === v ? 'border-verdigris-600 bg-verdigris-50' : 'border-slab-300'}`}>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="outcome" value={v} checked={outcome === v} onChange={() => setOutcome(v)} />
                {label}
              </span>
              <span className="mt-0.5 block pl-6 text-xs text-graphite-500">{hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Reason" hint="Both sides will read this.">
        {(id) => <textarea id={id} className="field min-h-24" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the evidence shows and why you decided this" />}
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" busy={busy} disabled={!outcome || reason.trim().length < 10} className="w-full">Record decision</Button>
    </form>
  );
}

export default function DisputeDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const admin = user.role === 'Admin';
  const { data, error, loading, reload } = useLoad(() => api(`/disputes/${id}`), [id]);
  const d = data?.dispute;
  const open = d && OPEN.includes(d.status);

  // new messages and decisions show up without a refresh
  useEffect(() => {
    if (!open) return undefined;
    const tick = () => { if (!document.hidden) reload(); };
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [open, reload]);

  async function act(path, done) {
    try {
      await api(`/disputes/${id}/${path}`, { method: 'POST' });
      toast(done);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (loading && !d) return <Spinner label="Loading dispute" />;
  if (error && !d) {
    return (
      <>
        <ErrorNote>{error}</ErrorNote>
        <p className="mt-3"><Link to={admin ? '/resolver' : '/disputes'} className="font-semibold text-verdigris-700 underline">Back to disputes</Link></p>
      </>
    );
  }
  if (!d) return null;

  const isParty = [d.buyer?._id, d.seller?._id].includes(user._id);
  const mine = String(d.raisedBy?._id) === String(user._id);
  const resolver = d.assignedTo;

  return (
    <>
      <p className="mb-3 text-sm"><Link to={admin ? '/resolver' : '/disputes'} className="font-semibold text-verdigris-700 hover:underline">← {admin ? 'Resolver' : 'Disputes'}</Link></p>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{d.subject}</h1>
          <StatusBadge status={d.status} />
        </div>
        <p className="mt-1 text-graphite-500">
          {CATEGORY_LABEL[d.category]} · raised by {partyName(d.raisedBy)} ({d.raisedBy?.role}) {ago(d.createdAt)}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Panel title="What happened">
            <p className="whitespace-pre-wrap break-words text-graphite-800">{d.description}</p>
            <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-slab-200 pt-4 text-sm sm:grid-cols-2">
              <div><dt className="text-graphite-500">Listing</dt><dd className="font-semibold">{d.listing?.title || 'Removed listing'}</dd></div>
              <div><dt className="text-graphite-500">Trade</dt><dd className="font-semibold">{kg(d.request?.quantityKg)} for {inr(d.request?.offerPrice)} <StatusBadge status={d.request?.status} /></dd></div>
            </dl>
          </Panel>
          <Evidence dispute={d} canAdd={isParty && open} onChanged={reload} />
          <Chat dispute={d} me={user} canPost={open} onChanged={reload} />
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Panel title="People">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-graphite-500">Buyer</dt><dd className="font-semibold">{partyName(d.buyer)} <span className="font-normal text-graphite-500">({d.buyer?.role}{d.buyer?.city ? `, ${d.buyer.city}` : ''})</span></dd></div>
              <div><dt className="text-graphite-500">Seller</dt><dd className="font-semibold">{partyName(d.seller)} <span className="font-normal text-graphite-500">({d.seller?.city || 'Company'})</span></dd></div>
              <div><dt className="text-graphite-500">Resolver</dt><dd className="font-semibold">{resolver ? resolver.name : 'Not assigned yet'}</dd></div>
            </dl>
          </Panel>

          {d.decision?.outcome && (
            <Panel title="Decision" className="border-verdigris-600">
              <p className="text-lg font-bold text-verdigris-700">{OUTCOME_LABEL[d.decision.outcome]}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{d.decision.reason}</p>
              {d.decision.effect && <p className="mt-3 rounded bg-slab-100 px-3 py-2 text-sm text-graphite-700">{d.decision.effect}</p>}
              <p className="mt-3 text-xs text-graphite-500">By {d.decision.decidedByName}, {when(d.decision.decidedAt)}</p>
            </Panel>
          )}

          {admin && open && (
            <Panel title="Resolver">
              {(d.status === 'open' || resolver?._id !== user._id) && (
                <Button variant="secondary" className="mb-4 w-full" onClick={() => act('review', d.status === 'open' ? 'You are reviewing this dispute' : 'You took over this case')}>
                  {d.status === 'open' ? 'Take this case' : 'Take over this case'}
                </Button>
              )}
              <DecisionForm dispute={d} onChanged={reload} />
            </Panel>
          )}

          {isParty && open && mine && (
            <Button variant="danger" className="w-full" onClick={() => window.confirm('Withdraw this dispute? It will be closed.') && act('withdraw', 'Dispute withdrawn')}>
              Withdraw dispute
            </Button>
          )}

          <Panel title="History">
            <ol className="space-y-3 border-l-2 border-slab-300 pl-4">
              {d.history.map((h) => (
                <li key={h._id} className="text-sm">
                  <p className="font-semibold">{HISTORY_LABEL[h.action] || h.action}</p>
                  {h.note && <p className="break-words text-graphite-600">{h.note}</p>}
                  <p className="text-xs text-graphite-500">{h.actorName} · {when(h.at)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
    </>
  );
}
