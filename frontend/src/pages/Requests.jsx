import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ago, inr, kg } from '../api';
import { useAuth } from '../auth';
import { MaterialName, MaterialPhoto } from '../components/MaterialTag';
import RaiseDisputeModal from '../components/RaiseDispute';
import {
  Button, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatusBadge, useLoad, useToast,
} from '../components/ui';

const OPEN = ['pending', 'accepted'];
// the seller has accepted at least once, so either side can dispute the trade
const DISPUTABLE = ['accepted', 'completed', 'cancelled'];

function ConfirmModal({ request, onClose, onDone }) {
  const toast = useToast();
  const [rating, setRating] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true);
    try {
      await api(`/requests/${request._id}`, { method: 'PATCH', body: { action: 'complete', rating } });
      toast('Trade completed');
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Confirm after inspection" onClose={onClose}>
      <p className="text-sm text-graphite-600">
        Only confirm once you have inspected “{request.listing?.title}” and agreed the handover. This marks the listing sold and counts it as diverted from landfill.
      </p>
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold">Rate the seller</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`grid h-10 w-10 cursor-pointer place-items-center rounded-md border font-bold ${rating === n ? 'border-verdigris-600 bg-verdigris-600 text-white' : 'border-slab-400'}`}>
              <input type="radio" name="rating" className="sr-only" checked={rating === n} onChange={() => setRating(n)} />{n}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>
      <Button className="mt-4 w-full" busy={busy} onClick={confirm}>Confirm and complete</Button>
    </Modal>
  );
}

function CancelModal({ request, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const accepted = request.status === 'accepted';
  async function cancel(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/requests/${request._id}`, { method: 'PATCH', body: { action: 'cancel', reason } });
      toast('Request cancelled');
      onDone();
      onClose();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  }
  return (
    <Modal title="Cancel request" onClose={onClose}>
      <form onSubmit={cancel} className="space-y-4">
        {accepted && <p className="text-sm text-graphite-600">The seller already accepted. Cancelling puts the listing back on the market, for example if the material failed inspection.</p>}
        <Field label="Reason (optional)">{(id) => <input id={id} className="field" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={accepted ? 'Failed inspection: hidden rust' : ''} />}</Field>
        <Button type="submit" variant="danger" busy={busy} className="w-full">Cancel request</Button>
      </form>
    </Modal>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const toast = useToast();
  const seller = user.role === 'Company';
  const [tab, setTab] = useState('open');
  const [confirming, setConfirming] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const [busy, setBusy] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api('/requests'), []);
  const items = (data?.items || []).filter((r) => (tab === 'open' ? OPEN.includes(r.status) : !OPEN.includes(r.status)));

  async function respond(r, action) {
    setBusy(`${r._id}${action}`);
    try {
      await api(`/requests/${r._id}`, { method: 'PATCH', body: { action } });
      toast(action === 'accept' ? 'Accepted, listing reserved for this buyer' : 'Request declined');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title={seller ? 'Requests' : 'My requests'}>
        {seller
          ? 'Buyers asking for your material. Accepting reserves the listing; the buyer confirms after inspecting it.'
          : 'Once a seller accepts, inspect the material, then confirm to complete the trade or cancel to release it.'}
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
          title={tab === 'open' ? 'No open requests' : 'Nothing closed yet'}
          action={!seller && tab === 'open' && <Link to="/marketplace"><Button>Browse the marketplace</Button></Link>}
        >
          {seller && tab === 'open' ? 'When a buyer asks for one of your listings it shows up here.' : null}
        </Empty>
      )}
      <ul className="space-y-3">
        {items.map((r) => (
          <li key={r._id} className="panel flex flex-col gap-3 p-4 sm:flex-row">
            <MaterialPhoto url={r.listing?.imageUrl} material={r.listing?.materialType} className="h-20 w-full shrink-0 rounded-md sm:w-28" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{r.listing?.title || 'Deleted listing'}</p>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-graphite-600">
                {r.listing && <MaterialName material={r.listing.materialType} />}
                <span className="figure">{kg(r.quantityKg)}</span>
                <span>Offer <strong className="figure text-graphite-900">{inr(r.offerPrice)}</strong>{r.listing && r.offerPrice !== r.listing.price ? ` (asking ${inr(r.listing.price)})` : ''}</span>
                {r.distanceKm != null && <span>{r.distanceKm} km apart</span>}
              </div>
              <p className="mt-1 text-sm text-graphite-500">
                {seller ? `From ${r.buyer?.organization || r.buyer?.name} (${r.buyer?.role})` : `Seller ${r.seller?.organization || r.seller?.name}`}, {ago(r.createdAt)}
              </p>
              {r.message && <p className="mt-2 rounded bg-slab-100 px-3 py-2 text-sm">“{r.message}”</p>}
              {r.cancelReason && <p className="mt-2 text-sm text-graphite-500">Reason: {r.cancelReason}</p>}
            </div>
            <div className="flex flex-wrap items-start gap-2 sm:flex-col">
              {seller && r.status === 'pending' && (
                <>
                  <Button size="sm" busy={busy === `${r._id}accept`} onClick={() => respond(r, 'accept')}>Accept</Button>
                  <Button size="sm" variant="secondary" busy={busy === `${r._id}reject`} onClick={() => respond(r, 'reject')}>Decline</Button>
                </>
              )}
              {seller && r.status === 'accepted' && <p className="text-sm text-graphite-500">Waiting for the buyer to inspect and confirm.</p>}
              {!seller && r.status === 'accepted' && <Button size="sm" onClick={() => setConfirming(r)}>Confirm after inspection</Button>}
              {!seller && OPEN.includes(r.status) && <Button size="sm" variant="ghost" onClick={() => setCancelling(r)}>Cancel</Button>}
              {r.dispute && (
                <Link to={`/disputes/${r.dispute._id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-verdigris-700 hover:underline">
                  View dispute <StatusBadge status={r.dispute.status} />
                </Link>
              )}
              {DISPUTABLE.includes(r.status) && !['open', 'under_review'].includes(r.dispute?.status) && (
                <Button size="sm" variant="secondary" onClick={() => setDisputing(r)}>Raise a dispute</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {confirming && <ConfirmModal request={confirming} onClose={() => setConfirming(null)} onDone={reload} />}
      {disputing && <RaiseDisputeModal request={disputing} onClose={() => setDisputing(null)} />}
      {cancelling && <CancelModal request={cancelling} onClose={() => setCancelling(null)} onDone={reload} />}
    </>
  );
}
