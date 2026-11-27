import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ago, inr, kg } from '../api';
import { useAuth } from '../auth';
import { MATERIAL_NAMES, MaterialPhoto, SalvageTag } from '../components/MaterialTag';
import {
  Button, Empty, ErrorNote, Modal, PageHeader, Spinner, StatusBadge, useToast,
} from '../components/ui';

const EXAMPLES = ['steel under 30k near me', 'bricks in good condition within 40 km', 'cheapest timber', '2 tonnes of concrete rubble'];

function describeFilters(f = {}) {
  const parts = [];
  if (f.material) parts.push(MATERIAL_NAMES[f.material]);
  if (f.min_price != null && f.max_price != null) parts.push(`${inr(f.min_price)} to ${inr(f.max_price)}`);
  else if (f.max_price != null) parts.push(`up to ${inr(f.max_price)}`);
  else if (f.min_price != null) parts.push(`from ${inr(f.min_price)}`);
  if (f.max_distance_km != null) parts.push(`within ${f.max_distance_km} km`);
  if (f.min_condition != null) parts.push(`condition ${f.min_condition}+`);
  if (f.min_quantity_kg != null) parts.push(`at least ${kg(f.min_quantity_kg)}`);
  if (f.city) parts.push(`around ${f.city}`);
  if (f.sort === 'price') parts.push('cheapest first');
  return parts;
}

const PART_LABEL = { sim: 'Fits your search', dist: 'Distance', price: 'Price per kg', rating: 'Seller rating' };

// What the buyer can do with this listing right now, in plain words.
function requestState(listing, user) {
  const open = ['pending', 'accepted'].includes(listing.myRequest?.status);
  if (user.role === 'Admin') return { kind: 'note', text: 'Admins monitor listings and cannot request material.' };
  if (user.role === 'Company') {
    return { kind: 'note', text: listing.isOwn ? 'This is your listing. Buyers request it and you answer under Requests.' : 'Seller accounts cannot request material. Use a Buyer or Recycler account to request it.' };
  }
  if (listing.isOwn) return { kind: 'note', text: 'This is your listing.' };
  if (open) return { kind: 'requested', status: listing.myRequest.status };
  if (listing.status && listing.status !== 'active') return { kind: 'note', text: `This listing is ${listing.status} and no longer takes requests.` };
  return { kind: 'form' };
}

function ListingModal({ listing, onClose, onRequested }) {
  const { user } = useAuth();
  const toast = useToast();
  const [offer, setOffer] = useState(String(listing.price));
  const [message, setMessage] = useState('');
  const [withMessage, setWithMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = requestState(listing, user);

  async function send(e) {
    e.preventDefault();
    setError('');
    const price = Number(offer);
    if (!Number.isFinite(price) || price < 0) { setError('Enter your offer as a number, for example 2500.'); return; }
    setBusy(true);
    try {
      const r = await api('/requests', { method: 'POST', body: { listingId: listing._id, offerPrice: price, message } });
      toast('Request sent to the seller');
      onRequested(listing._id, { _id: r.request._id, status: r.request.status });
    } catch (err) {
      setError(err.message);
      if (err.status === 409) onRequested(listing._id, { status: 'pending' }); // already requested elsewhere
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={listing.title} onClose={onClose}>
      <MaterialPhoto url={listing.imageUrl} material={listing.materialType} className="mb-4 aspect-video w-full rounded-md" />
      <SalvageTag material={listing.materialType} quantityKg={listing.quantityKg} conditionScore={listing.conditionScore} conditionLabel={listing.conditionLabel} price={listing.price} tone="white" />
      {listing.description && <p className="mt-4 whitespace-pre-line text-sm text-graphite-700">{listing.description}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-graphite-500">Seller</dt>
        <dd>{listing.seller?.organization || listing.seller?.name} ({(listing.seller?.rating ?? 4).toFixed(1)}/5)</dd>
        <dt className="text-graphite-500">Location</dt>
        <dd>{listing.city || 'Not given'}{listing.distanceKm != null ? `, ${listing.distanceKm} km from you` : ''}</dd>
        <dt className="text-graphite-500">Price per kg</dt>
        <dd className="figure">{inr(listing.price / listing.quantityKg)}</dd>
        <dt className="text-graphite-500">CO₂e avoided</dt>
        <dd>about {kg(listing.co2SavedKg || 0)} (estimate)</dd>
      </dl>
      {listing.match && (
        <div className="mt-4 rounded-md bg-slab-100 p-3 text-sm">
          <p className="font-semibold">Match {Math.round(listing.match.score * 100)}%</p>
          <ul className="mt-1 grid grid-cols-2 gap-1 text-graphite-600">
            {Object.entries(listing.match.parts).map(([k, v]) => <li key={k}>{PART_LABEL[k]}: {Math.round(v * 100)}</li>)}
          </ul>
        </div>
      )}
      {listing.isDemo && <p className="mt-3 text-xs text-graphite-500">This is a generated demo listing, not real stock.</p>}

      {/* Always in view at the bottom of the pop-up, so the request never hides below the fold. */}
      <div className="sticky -bottom-5 -mx-5 mt-5 border-t border-slab-300 bg-white px-5 pb-5 pt-4 shadow-[0_-8px_12px_-8px_rgba(31,36,39,0.15)]">
        {state.kind === 'form' && (
          <form onSubmit={send} className="space-y-3" aria-label="Request this material">
            {listing.myRequest && (
              <p className="text-sm text-graphite-500">Your earlier request was {listing.myRequest.status}. You can send a new one.</p>
            )}
            {withMessage && (
              <div>
                <label htmlFor="req-msg" className="mb-1 block text-sm font-semibold">Message to the seller</label>
                <textarea id="req-msg" rows={2} maxLength={1000} className="field" placeholder="When can you collect? Do you need loading help?" value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
            )}
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <label htmlFor="req-offer" className="mb-1 block text-sm font-semibold">Your offer (₹)</label>
                <input id="req-offer" type="number" min="0" inputMode="decimal" className="field" value={offer} onChange={(e) => setOffer(e.target.value)} />
              </div>
              <Button type="submit" size="lg" busy={busy}>Send request</Button>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-graphite-500">
              <span>Asking price is filled in. The seller accepts or declines; you inspect before confirming.</span>
              {!withMessage && <button type="button" className="shrink-0 font-semibold text-verdigris-700 hover:underline" onClick={() => setWithMessage(true)}>Add a message</button>}
            </div>
            <ErrorNote>{error}</ErrorNote>
          </form>
        )}
        {state.kind === 'requested' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              Your request <StatusBadge status={state.status} />
              <span className="font-normal text-graphite-500">{state.status === 'pending' ? 'Waiting for the seller to reply.' : 'Accepted. Inspect it, then confirm under My requests.'}</span>
            </p>
            <Link to="/requests"><Button variant="secondary" size="sm">Open My requests</Button></Link>
          </div>
        )}
        {state.kind === 'note' && <p className="text-sm text-graphite-600">{state.text}</p>}
      </div>
    </Modal>
  );
}

export default function Marketplace() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('nl') || '');
  const [filters, setFilters] = useState({ material: params.get('material') || '', maxDistanceKm: '', sort: '' });
  const [result, setResult] = useState(null);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const nl = params.get('nl') || '';
  const linked = params.get('listing');

  // opened from a notification or a Wanted alert: /marketplace?listing=<id>
  useEffect(() => {
    if (!linked) return;
    api(`/listings/${linked}`)
      .then((r) => setOpen({ ...r.listing, isOwn: String(r.listing.seller?._id) === String(user._id) }))
      .catch((err) => setError(err.status === 404 ? 'That listing is no longer available.' : err.message));
  }, [linked, user._id]);
  function closeModal() {
    setOpen(null);
    if (linked) {
      const next = new URLSearchParams(params);
      next.delete('listing');
      setParams(next, { replace: true });
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api('/listings', { query: { nl, ...filters, page, limit: 12 } })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [nl, filters, page]);

  // after a request is sent: the card and the open pop-up both show its status straight away
  function markRequested(listingId, myRequest) {
    setItems((prev) => prev.map((l) => (l._id === listingId ? { ...l, myRequest } : l)));
    setOpen((cur) => (cur && cur._id === listingId ? { ...cur, myRequest } : cur));
  }

  function search(q) {
    setText(q);
    setPage(1);
    setParams(q ? { nl: q } : {});
  }
  const setFilter = (k) => (e) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };
  const understood = describeFilters(result?.filters);

  return (
    <>
      <PageHeader title="Marketplace">
        Search the way you would ask a supplier. Results are ranked by how well they fit, how close they are, price per kg and seller rating.
      </PageHeader>

      <form onSubmit={(e) => { e.preventDefault(); search(text.trim()); }} className="flex gap-2">
        <label htmlFor="nl" className="sr-only">Search listings</label>
        <input id="nl" className="field text-lg" placeholder="e.g. steel under 30k near me" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
        <Button type="submit" size="lg">Search</Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {!nl && EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => search(ex)} className="rounded-full border border-slab-400 bg-white px-3 py-1 text-graphite-600 hover:border-verdigris-600">{ex}</button>
        ))}
        {nl && understood.length > 0 && (
          <p className="text-graphite-600">
            Searching for <strong>{understood.join(', ')}</strong>
            {result?.parser === 'local' && ' (basic parser, AI service offline)'}.{' '}
            <button className="font-semibold text-verdigris-700 hover:underline" onClick={() => search('')}>Clear</button>
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <select aria-label="Material" className="field w-auto" value={filters.material} onChange={setFilter('material')}>
          <option value="">All materials</option>
          {Object.entries(MATERIAL_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Distance" className="field w-auto" value={filters.maxDistanceKm} onChange={setFilter('maxDistanceKm')}>
          <option value="">Any distance</option>
          {[10, 25, 50, 100, 500].map((d) => <option key={d} value={d}>Within {d} km</option>)}
        </select>
        <select aria-label="Sort" className="field w-auto" value={filters.sort} onChange={setFilter('sort')}>
          <option value="">Best match</option>
          <option value="price">Lowest price</option>
        </select>
        {!user.city && <p className="self-center text-sm text-graphite-500">Set your city under Account to see distances.</p>}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {result && (
        <p className="mb-3 mt-6 text-sm text-graphite-500">
          {result.total} listing{result.total === 1 ? '' : 's'}{result.origin ? `, distances from ${result.origin}` : ''}
        </p>
      )}
      {result && !result.total && !loading && (
        <Empty title="No listings match">Try a larger distance, a higher price limit or a different material.</Empty>
      )}
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((l) => (
          <li key={l._id}>
            <button onClick={() => setOpen(l)} className="group block w-full text-left">
              <div className="relative">
                <MaterialPhoto url={l.imageUrl} material={l.materialType} className={`w-full rounded-t-lg ${l.imageUrl ? 'aspect-[16/10]' : 'h-12'}`} label={false} />
                <span className="figure absolute right-2 top-2 rounded bg-graphite-900/85 px-2 py-0.5 text-sm font-bold text-white">
                  {Math.round(l.match.score * 100)}% match
                </span>
                {['pending', 'accepted'].includes(l.myRequest?.status) && (
                  <span className="absolute left-2 top-2 rounded bg-tag-300 px-2 py-0.5 text-xs font-bold text-graphite-900">
                    {l.myRequest.status === 'accepted' ? 'Request accepted' : 'Requested'}
                  </span>
                )}
              </div>
              <SalvageTag material={l.materialType} title={l.title} quantityKg={l.quantityKg} conditionScore={l.conditionScore} conditionLabel={l.conditionLabel} price={l.price}>
                <p className="mt-1 flex items-center justify-between text-xs">
                  <span>{l.city}{l.distanceKm != null ? `, ${l.distanceKm} km` : ''}</span>
                  <span>{l.isOwn ? 'Your listing' : ago(l.publishedAt)}</span>
                </p>
              </SalvageTag>
            </button>
          </li>
        ))}
      </ul>
      {loading && <div className="mt-6"><Spinner label="Searching" /></div>}
      {result && page < result.pages && !loading && (
        <div className="mt-6 text-center"><Button variant="secondary" onClick={() => setPage(page + 1)}>Show more</Button></div>
      )}
      {open && <ListingModal key={open._id} listing={open} onClose={closeModal} onRequested={markRequested} />}
    </>
  );
}
