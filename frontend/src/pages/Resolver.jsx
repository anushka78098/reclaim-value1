import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ago } from '../api';
import { CATEGORIES, CATEGORY_LABEL, OUTCOME_LABEL, partyName } from '../disputes';
import {
  Empty, ErrorNote, PageHeader, Spinner, Stat, StatusBadge, useLoad,
} from '../components/ui';

// Admin dashboard: the queue of disputes, and the history of everything decided.
export default function Resolver() {
  const [tab, setTab] = useState('queue');
  const [category, setCategory] = useState('');
  const stats = useLoad(() => api('/disputes/stats'), []);
  const list = useLoad(() => api('/disputes', { query: { status: tab === 'queue' ? 'open' : 'closed', category } }), [tab, category]);
  const s = stats.data;
  const rows = [...(list.data?.items || [])];
  // oldest waiting first in the queue; newest decision first in the history
  if (tab === 'queue') rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return (
    <>
      <PageHeader title="Resolver">Review disputes, read both sides, and record a final decision. Every action is kept in the dispute history.</PageHeader>
      <ErrorNote>{stats.error}</ErrorNote>
      {s && (
        <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat value={s.byStatus.open || 0} label="Waiting for review" />
          <Stat value={s.byStatus.under_review || 0} label="Under review" />
          <Stat value={s.byStatus.resolved || 0} label="Resolved" note={s.byOutcome && Object.keys(s.byOutcome).length ? Object.entries(s.byOutcome).map(([k, n]) => `${n} ${OUTCOME_LABEL[k].toLowerCase()}`).join(', ') : undefined} />
          <Stat value={s.avgResolutionHours != null ? `${s.avgResolutionHours} h` : '-'} label="Average time to resolve" />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" className="flex gap-1 border-b border-slab-300">
          {[['queue', 'Queue'], ['history', 'Resolution history']].map(([v, label]) => (
            <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === v ? 'border-verdigris-600 text-verdigris-700' : 'border-transparent text-graphite-500'}`}>
              {label}
            </button>
          ))}
        </div>
        <select aria-label="Category" className="field w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>

      {list.loading && !list.data && <Spinner />}
      <ErrorNote>{list.error}</ErrorNote>
      {list.data && !rows.length && (
        <Empty title={tab === 'queue' ? 'Nothing to review' : 'No decisions yet'}>
          {tab === 'queue' ? 'New disputes from buyers and sellers appear here and in your notifications.' : 'Decided and withdrawn disputes are kept here.'}
        </Empty>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slab-300 text-left text-graphite-500">
                <th className="py-2">Dispute</th><th>Category</th><th>Buyer / seller</th><th>Status</th>
                <th>{tab === 'queue' ? 'Opened' : 'Decision'}</th><th>Resolver</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d._id} className="border-b border-slab-200 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-semibold">{d.subject}</p>
                    <p className="text-graphite-500">{d.listing?.title}</p>
                  </td>
                  <td className="pr-3">{CATEGORY_LABEL[d.category]}</td>
                  <td className="pr-3">{partyName(d.buyer)}<br /><span className="text-graphite-500">{partyName(d.seller)}</span></td>
                  <td className="pr-3"><StatusBadge status={d.status} /></td>
                  <td className="pr-3">
                    {tab === 'queue'
                      ? ago(d.createdAt)
                      : d.decision ? <><span className="font-semibold">{OUTCOME_LABEL[d.decision.outcome]}</span><br /><span className="text-graphite-500">{ago(d.decision.decidedAt)}</span></> : <span className="text-graphite-500">Withdrawn</span>}
                  </td>
                  <td className="pr-3">{d.assignedTo?.name || <span className="text-graphite-400">Unassigned</span>}</td>
                  <td className="text-right"><Link to={`/disputes/${d._id}`} className="font-semibold text-verdigris-700 hover:underline">{tab === 'queue' ? 'Review' : 'Open'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
