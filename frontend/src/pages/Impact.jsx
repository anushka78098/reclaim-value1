import { useState } from 'react';
import { api, inr, kg } from '../api';
import { useAuth } from '../auth';
import { MaterialBars, MonthlyColumns } from '../components/Charts';
import { MATERIAL_NAMES, MaterialName } from '../components/MaterialTag';
import { ErrorNote, PageHeader, Spinner, Stat, useAutoRefresh, useLoad } from '../components/ui';
import { ago } from '../api';

function Metric({ label, value, target, note }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slab-300 py-3">
      <div>
        <p className="font-semibold">{label}</p>
        {note && <p className="text-sm text-graphite-500">{note}</p>}
      </div>
      <div className="text-right">
        <p className="figure text-xl font-bold">{value ?? 'Not enough data'}</p>
        {target && <p className="text-xs text-graphite-500">{target}</p>}
      </div>
    </div>
  );
}

export default function Impact() {
  const { user } = useAuth();
  const [metric, setMetric] = useState('divertedKg');
  const [asTable, setAsTable] = useState(false);
  const { data: s, error, loading, reload } = useLoad(() => api('/analytics/summary'), []);
  const { data: recs, reload: reloadRecs } = useLoad(() => api('/analytics/impact-records'), []);
  useAutoRefresh(() => { reload(); reloadRecs(); }, 30000);
  const supply = s && s.scope !== 'buyer';
  const otherSide = user.role === 'Company' ? 'Buyer' : user.role === 'Admin' ? 'Seller and buyer' : 'Seller';

  return (
    <>
      <PageHeader title="Impact">
        {user.role === 'Admin' ? 'Platform-wide' : 'Your'} landfill diversion and carbon savings.
        CO₂ figures are estimates from embodied-carbon factors per material: reuse and sale count in full, recycling 45%, disposal nothing.
      </PageHeader>
      {loading && !s && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {s && (
        <>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <Stat value={kg(s.divertedKg)} label="Kept out of landfill" />
            <Stat value={kg(s.co2SavedKg)} label="CO₂e avoided (estimate)" />
            {supply ? <Stat value={s.diversionRate != null ? `${s.diversionRate}%` : '-'} label="Diversion rate" note="Target 40% or more" /> : <Stat value={s.purchases} label="Completed purchases" />}
            {supply ? <Stat value={inr(s.revenue)} label="Revenue from trades" /> : <Stat value={inr(s.spend)} label="Spent" />}
          </div>

          <section className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-bold">Last six months</h2>
                <div className="flex gap-1 text-sm" role="group" aria-label="Measure">
                  {[['divertedKg', 'Diverted'], ['co2SavedKg', 'CO₂e']].map(([k, l]) => (
                    <button key={k} aria-pressed={metric === k} onClick={() => setMetric(k)} className={`rounded-md px-3 py-1 font-semibold ${metric === k ? 'bg-graphite-900 text-white' : 'text-graphite-600 hover:bg-slab-200'}`}>{l}</button>
                  ))}
                  <button aria-pressed={asTable} onClick={() => setAsTable(!asTable)} className="rounded-md px-3 py-1 font-semibold text-verdigris-700 hover:bg-verdigris-50">{asTable ? 'Chart' : 'Table'}</button>
                </div>
              </div>
              {asTable ? (
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slab-300 text-left text-graphite-500"><th className="py-2">Month</th><th className="text-right">Diverted</th><th className="text-right">CO₂e</th></tr></thead>
                  <tbody>{s.monthly.map((m) => <tr key={m.month} className="border-b border-slab-200"><td className="py-2">{m.month}</td><td className="figure text-right">{kg(m.divertedKg)}</td><td className="figure text-right">{kg(m.co2SavedKg)}</td></tr>)}</tbody>
                </table>
              ) : (
                <MonthlyColumns data={s.monthly} valueKey={metric} label={`${metric === 'divertedKg' ? 'Material diverted' : 'CO2e avoided'} per month`} />
              )}
            </div>
            <div>
              <h2 className="mb-3 text-xl font-bold">By material</h2>
              <MaterialBars data={s.byMaterial} valueKey={metric} />
              {asTable && (
                <table className="mt-4 w-full text-sm">
                  <tbody>{s.byMaterial.map((m) => <tr key={m.material} className="border-b border-slab-200"><td className="py-1.5">{MATERIAL_NAMES[m.material]}</td><td className="figure text-right">{kg(m.divertedKg)}</td><td className="figure text-right">{kg(m.co2SavedKg)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="mb-1 text-xl font-bold">CO₂ saved per completed trade</h2>
            <p className="mb-3 text-sm text-graphite-500">
              {user.role === 'Admin' ? 'Every trade on the platform' : user.role === 'Company' ? 'Your sales' : 'Your purchases'}: saved once, when the buyer confirms the trade, and kept in the database.
              {recs && recs.totals.trades > 0 && <> Total <strong>{kg(recs.totals.co2SavedKg)} CO₂e</strong> over {recs.totals.trades} trade{recs.totals.trades === 1 ? '' : 's'}.</>}
            </p>
            {recs && !recs.items.length && <p className="rounded-md border border-dashed border-slab-400 px-4 py-6 text-sm text-graphite-500">No trade has been completed yet. The saving is recorded here as soon as one is.</p>}
            {recs && recs.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="border-b border-slab-300 text-left text-graphite-500"><th className="py-2">Listing</th><th>Material</th><th>{otherSide}</th><th className="text-right">Quantity</th><th className="text-right">CO₂e</th><th className="text-right">Completed</th></tr></thead>
                  <tbody>
                    {recs.items.map((r) => (
                      <tr key={r._id} className="border-b border-slab-200">
                        <td className="py-2 font-semibold">{r.listing}</td>
                        <td><MaterialName material={r.materialType} /></td>
                        <td>{user.role === 'Admin' ? `${r.seller} / ${r.buyer}` : r.counterparty}</td>
                        <td className="figure text-right">{kg(r.quantityKg)}</td>
                        <td className="figure text-right">{kg(r.co2SavedKg)}</td>
                        <td className="text-right text-graphite-500">{ago(r.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {supply && (
            <section className="mt-10 max-w-2xl">
              <h2 className="mb-1 text-xl font-bold">Pilot metrics</h2>
              <p className="mb-2 text-sm text-graphite-500">Measured from timestamps and your choices, as defined in the project report.</p>
              <Metric
                label="Median time-to-match"
                note={s.ttm.matchedListings ? `${s.ttm.matchedListings} listing${s.ttm.matchedListings === 1 ? '' : 's'} received interest; ${s.ttm.within48h}% within 48 h` : 'Time from publishing to the first buyer request'}
                value={s.ttm.medianHours != null ? (s.ttm.medianHours < 1 ? 'under 1 h' : `${s.ttm.medianHours} h`) : null}
                target="Target 48 h or less"
              />
              <Metric label="Classification accuracy" note={`AI material type kept by the user, across ${s.aiReviewed} analysed photos`} value={s.classificationAccuracy != null ? `${s.classificationAccuracy}%` : null} />
              <Metric label="Price acceptance" note="Listings published at the AI-suggested price (within 2%)" value={s.priceAcceptanceRate != null ? `${s.priceAcceptanceRate}%` : null} />
              <Metric label="Landfill diversion rate" note="Reused, sold or recycled, as a share of everything closed" value={s.diversionRate != null ? `${s.diversionRate}%` : null} target="Target 40% or more" />
            </section>
          )}
        </>
      )}
    </>
  );
}
