import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ago } from '../api';
import { useAuth } from '../auth';
import { CATEGORY_LABEL, OUTCOME_LABEL, partyName } from '../disputes';
import {
  Button, Empty, ErrorNote, PageHeader, Spinner, StatusBadge, useLoad,
} from '../components/ui';

// A person's own disputes (buyer, recycler or company). Admins use the Resolver page.
export default function Disputes() {
  const { user } = useAuth();
  const [tab, setTab] = useState('open');
  const { data, error, loading } = useLoad(() => api('/disputes', { query: { status: tab } }), [tab]);
  const items = data?.items || [];
  return (
    <>
      <PageHeader title="Disputes">
        If a trade goes wrong, raise a dispute from <Link to="/requests" className="font-semibold text-verdigris-700 underline">Requests</Link>. Both sides add evidence and talk in the dispute chat, then a resolver decides.
      </PageHeader>
      <div role="tablist" className="mb-5 flex gap-1 border-b border-slab-300">
        {[['open', 'Open'], ['closed', 'Closed']].map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === v ? 'border-verdigris-600 text-verdigris-700' : 'border-transparent text-graphite-500'}`}>
            {label}
          </button>
        ))}
      </div>
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {data && !items.length && (
        <Empty
          title={tab === 'open' ? 'No open disputes' : 'No closed disputes'}
          action={tab === 'open' && <Link to="/requests"><Button>Go to requests</Button></Link>}
        >
          {tab === 'open' ? 'Raise one from a request once the seller has accepted it.' : 'Decided and withdrawn disputes are kept here.'}
        </Empty>
      )}
      <ul className="space-y-3">
        {items.map((d) => {
          const mine = String(d.buyer?._id) === String(user._id) ? d.seller : d.buyer;
          return (
            <li key={d._id}>
              <Link to={`/disputes/${d._id}`} className="panel block p-4 hover:border-verdigris-400">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{d.subject}</p>
                  <StatusBadge status={d.status} />
                  {d.decision && <span className="text-sm font-semibold text-verdigris-700">{OUTCOME_LABEL[d.decision.outcome]}</span>}
                </div>
                <p className="mt-1 text-sm text-graphite-600">
                  {CATEGORY_LABEL[d.category]}{d.listing?.title ? `, ${d.listing.title}` : ''} · with {partyName(mine)}
                </p>
                <p className="mt-1 text-xs text-graphite-500">
                  {d.evidenceCount} evidence · {d.messageCount} message{d.messageCount === 1 ? '' : 's'} · updated {ago(d.updatedAt)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
