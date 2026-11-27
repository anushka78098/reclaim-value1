import { useState } from 'react';
import { api, ago, inr, kg } from '../api';
import { useAuth } from '../auth';
import { MaterialName } from '../components/MaterialTag';
import {
  Button, ErrorNote, PageHeader, Spinner, Stat, StatusBadge, useLoad, useToast,
} from '../components/ui';

function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => api('/admin/users', { query: { q } }), [q]);

  async function update(u, body, msg) {
    try {
      await api(`/admin/users/${u._id}`, { method: 'PATCH', body });
      toast(msg);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <label htmlFor="user-q" className="sr-only">Search users</label>
      <input id="user-q" className="field mb-4 max-w-sm" placeholder="Search name, email or organisation" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slab-300 text-left text-graphite-500"><th className="py-2">User</th><th>Role</th><th>City</th><th>Rating</th><th>Joined</th><th /></tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u._id} className={`border-b border-slab-200 ${u.suspended ? 'text-graphite-400' : ''}`}>
                <td className="py-2.5">
                  <p className="font-semibold">{u.name}{u.isDemo ? ' (demo)' : ''}</p>
                  <p className="text-graphite-500">{u.email}{u.organization ? `, ${u.organization}` : ''}</p>
                </td>
                <td>
                  <select aria-label={`Role for ${u.name}`} className="rounded border border-slab-400 bg-white px-2 py-1" value={u.role} disabled={u._id === me._id} onChange={(e) => update(u, { role: e.target.value }, 'Role changed')}>
                    {['Company', 'Buyer', 'Recycler', 'Admin'].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td>{u.city || '-'}</td>
                <td className="figure">{u.rating?.toFixed(1)}</td>
                <td>{ago(u.createdAt)}</td>
                <td className="text-right">
                  {u._id !== me._id && (u.suspended
                    ? <Button size="sm" variant="secondary" onClick={() => update(u, { suspended: false }, 'Account restored')}>Restore</Button>
                    : <Button size="sm" variant="danger" onClick={() => window.confirm(`Suspend ${u.name}? Their live listings will be withdrawn.`) && update(u, { suspended: true }, 'Account suspended')}>Suspend</Button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Listings() {
  const toast = useToast();
  const [status, setStatus] = useState('active');
  const { data, error, loading, reload } = useLoad(() => api('/admin/listings', { query: { status } }), [status]);
  async function withdraw(l) {
    if (!window.confirm(`Withdraw "${l.title}"? Open requests on it will be declined.`)) return;
    try {
      await api(`/admin/listings/${l._id}`, { method: 'PATCH', body: { status: 'withdrawn' } });
      toast('Listing withdrawn');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  return (
    <>
      <select aria-label="Status" className="field mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
        {['active', 'reserved', 'sold', 'withdrawn'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        <option value="">All</option>
      </select>
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-slab-300 text-left text-graphite-500"><th className="py-2">Listing</th><th>Material</th><th>Price</th><th>Seller</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l._id} className="border-b border-slab-200">
                <td className="py-2.5 font-semibold">{l.title}</td>
                <td><MaterialName material={l.materialType} /></td>
                <td className="figure">{inr(l.price)}</td>
                <td>{l.seller?.organization || l.seller?.name}</td>
                <td><StatusBadge status={l.status} /></td>
                <td className="text-right">{['active', 'reserved'].includes(l.status) && <Button size="sm" variant="danger" onClick={() => withdraw(l)}>Withdraw</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.items.length && <p className="py-6 text-sm text-graphite-500">No listings with this status.</p>}
      </div>
    </>
  );
}

function Transactions() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useLoad(() => api('/admin/transactions', { query: { status } }), [status]);
  return (
    <>
      <select aria-label="Status" className="field mb-4 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All trades</option>
        {['pending', 'accepted', 'completed', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
      </select>
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-slab-300 text-left text-graphite-500"><th className="py-2">Listing</th><th>Seller</th><th>Buyer</th><th className="text-right">Offer</th><th>Status</th><th className="text-right">CO₂e</th><th className="text-right">Requested</th></tr></thead>
          <tbody>
            {data?.items.map((r) => (
              <tr key={r._id} className="border-b border-slab-200">
                <td className="py-2.5 font-semibold">{r.listing?.title || 'Deleted listing'}</td>
                <td>{r.seller?.organization || r.seller?.name}</td>
                <td>{r.buyer?.organization || r.buyer?.name} <span className="text-graphite-400">({r.buyer?.role})</span></td>
                <td className="figure text-right">{inr(r.offerPrice)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="figure text-right">{r.co2SavedKg != null ? kg(r.co2SavedKg) : '-'}</td>
                <td className="text-right text-graphite-500">{ago(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.items.length && <p className="py-6 text-sm text-graphite-500">No trades with this status.</p>}
      </div>
    </>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('users');
  const { data } = useLoad(() => api('/admin/overview'), []);
  return (
    <>
      <PageHeader title="Moderation">Manage accounts and take down listings that break the rules.</PageHeader>
      {data && (
        <div className="mb-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat value={data.users.Company || 0} label="Companies" />
          <Stat value={(data.users.Buyer || 0) + (data.users.Recycler || 0)} label="Buyers and recyclers" />
          <Stat value={data.counts.activeListings} label="Live listings" />
          <Stat value={data.counts.requests?.pending || 0} label="Requests awaiting sellers" />
        </div>
      )}
      <div role="tablist" className="mb-5 flex gap-1 border-b border-slab-300">
        {[['users', 'Users'], ['listings', 'Listings'], ['transactions', 'Transactions']].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === v ? 'border-verdigris-600 text-verdigris-700' : 'border-transparent text-graphite-500'}`}>{l}</button>
        ))}
      </div>
      {tab === 'users' ? <Users /> : tab === 'listings' ? <Listings /> : <Transactions />}
    </>
  );
}
