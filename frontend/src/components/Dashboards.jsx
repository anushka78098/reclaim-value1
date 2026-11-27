import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ago, inr, kg } from '../api';
import { MATERIAL_NAMES, Swatch } from './MaterialTag';
import { Button, StatusBadge, Stat } from './ui';

// Everything here is drawn from what /api/analytics/dashboard returns for the signed-in
// account. Nothing on this page is typed in by hand.

// Fixed categorical order (never cycled): verdigris, ochre, slate, brick.
const C = { a: '#1E6E66', b: '#B88A0B', c: '#6E7C87', d: '#A23E2C' };
const STATUS_COLOR = { pending: '#B88A0B', accepted: '#2D8378', completed: '#175650', rejected: '#A23E2C', cancelled: '#8A9096' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlabel = (key) => MONTHS[Number(key.slice(5)) - 1];
const num = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const tick = { fontSize: 12, fill: '#5B6267' };
const legendText = (v) => <span style={{ color: '#41474B' }}>{v}</span>;

function Panel({ title, note, children, className = '' }) {
  return (
    <section className={`min-w-0 ${className}`}>
      <h2 className="text-xl font-bold">{title}</h2>
      {note && <p className="mb-3 text-sm text-graphite-500">{note}</p>}
      <div className={note ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function Table({ columns, rows, empty = 'Nothing here yet.' }) {
  if (!rows.length) return <p className="rounded-md border border-dashed border-slab-400 px-4 py-6 text-sm text-graphite-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-slab-300 text-left text-graphite-500">
            {columns.map((c) => <th key={c.key} className={`py-2 pr-3 font-semibold ${c.right ? 'text-right' : ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r._id || i} className="border-b border-slab-200">
              {columns.map((c) => <td key={c.key} className={`py-2 pr-3 ${c.right ? 'figure text-right' : ''} ${c.nowrap ? 'whitespace-nowrap' : ''}`}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A chart with a "Table" switch so the same numbers can be read without colour or shapes.
function ChartCard({ title, note, data, columns, tableMode, children, empty }) {
  const hasData = data.some((d) => columns.slice(1).some((c) => Number(d[c.key]) > 0));
  return (
    <Panel title={title} note={note}>
      {!hasData ? <p className="rounded-md border border-dashed border-slab-400 px-4 py-10 text-center text-sm text-graphite-500">{empty || 'No activity recorded yet. It will appear here as soon as there is some.'}</p>
        : tableMode ? <Table columns={columns} rows={data} />
          : <div className="h-64 w-full" role="img" aria-label={title}>{children}</div>}
    </Panel>
  );
}

function MonthBars({ data, series, unit = (v) => num(v) }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke="#E6E8E4" vertical={false} />
        <XAxis dataKey="month" tickFormatter={mlabel} tick={tick} axisLine={{ stroke: '#C5C9C4' }} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip formatter={(v, name) => [unit(v), name]} labelFormatter={(m) => `${mlabel(m)} ${m.slice(0, 4)}`} cursor={{ fill: '#F1F2EF' }} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={26} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function MonthArea({ data, dataKey, name, color = C.a, unit = (v) => `${num(v)} kg` }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="#E6E8E4" vertical={false} />
        <XAxis dataKey="month" tickFormatter={mlabel} tick={tick} axisLine={{ stroke: '#C5C9C4' }} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [unit(v), name]} labelFormatter={(m) => `${mlabel(m)} ${m.slice(0, 4)}`} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.15} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function MaterialBarsChart({ data, dataKey, name, color = C.a, unit = (v) => `${num(v)} kg` }) {
  const rows = data.map((d) => ({ ...d, label: MATERIAL_NAMES[d.material] || d.material }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke="#E6E8E4" horizontal={false} />
        <XAxis type="number" tick={tick} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={tick} axisLine={false} tickLine={false} width={64} />
        <Tooltip formatter={(v) => [unit(v), name]} cursor={{ fill: '#F1F2EF' }} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function StatusDonut({ counts }) {
  const rows = Object.entries(counts).filter(([, n]) => n > 0).map(([status, n]) => ({ status, name: status[0].toUpperCase() + status.slice(1), value: n }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="#fff" strokeWidth={2}>
          {rows.map((r) => <Cell key={r.status} fill={STATUS_COLOR[r.status]} />)}
        </Pie>
        <Tooltip formatter={(v, name) => [v, name]} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
      </PieChart>
    </ResponsiveContainer>
  );
}

const materialCell = (r) => (r.materialType
  ? <span className="inline-flex items-center gap-1.5"><Swatch material={r.materialType} />{r.listing}</span> : r.listing);

function ModeSwitch({ tableMode, setTableMode }) {
  return (
    <button onClick={() => setTableMode(!tableMode)} aria-pressed={tableMode} className="rounded-md px-3 py-1 text-sm font-semibold text-verdigris-700 hover:bg-verdigris-50">
      {tableMode ? 'Show charts' : 'Show as tables'}
    </button>
  );
}

function PlatformStrip({ platform }) {
  if (!platform) return null;
  return (
    <p className="mt-6 rounded-md bg-verdigris-50 px-4 py-3 text-sm text-verdigris-800">
      Across all of Reclaim Value, <strong>{kg(platform.divertedKg)}</strong> have been kept out of landfill, avoiding about <strong>{kg(platform.co2SavedKg)} CO₂e</strong> over {platform.trades} completed trade{platform.trades === 1 ? '' : 's'}.
    </p>
  );
}

const ACTIVITY_LABEL = { listing: 'Listing', request: 'Request', accepted: 'Accepted', rejected: 'Declined', completed: 'Completed' };

// ------------------------------------------------------------------ seller
export function SellerDashboard({ d }) {
  const [tableMode, setTableMode] = useState(false);
  const t = d.totals;
  return (
    <>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat value={t.listings} label="Total listings" note={`${t.reservedListings} reserved, ${t.withdrawnListings} withdrawn`} />
        <Stat value={t.activeListings} label="Active listings" />
        <Stat value={t.completedListings} label="Completed (sold)" />
        <Stat value={t.incomingRequests} label="Incoming requests" note={t.pendingRequests ? `${t.pendingRequests} waiting for you` : 'None waiting'} />
        <Stat value={kg(t.wasteRecoveredKg)} label="Waste recovered" />
        <Stat value={kg(t.co2SavedKg)} label="CO₂e avoided" note="Saved when each trade completes" />
        <Stat value={inr(t.revenue)} label="Revenue from trades" />
        <Stat value={t.trades} label="Completed trades" />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link to="/capture"><Button size="lg">Capture material</Button></Link>
        <Link to="/requests"><Button variant="secondary" size="lg">{t.pendingRequests ? `Answer ${t.pendingRequests} request${t.pendingRequests > 1 ? 's' : ''}` : 'View requests'}</Button></Link>
        <div className="ml-auto"><ModeSwitch tableMode={tableMode} setTableMode={setTableMode} /></div>
      </div>
      <PlatformStrip platform={d.platform} />

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ChartCard title="Monthly activity" note="Last six months" data={d.monthly} tableMode={tableMode}
          columns={[{ key: 'month', label: 'Month', render: (r) => `${mlabel(r.month)} ${r.month.slice(0, 4)}` }, { key: 'listings', label: 'Listings', right: true }, { key: 'requests', label: 'Requests', right: true }, { key: 'trades', label: 'Trades', right: true }]}
        >
          <MonthBars data={d.monthly} series={[{ key: 'listings', name: 'Listings', color: C.a }, { key: 'requests', name: 'Requests received', color: C.b }, { key: 'trades', name: 'Trades completed', color: C.c }]} />
        </ChartCard>
        <ChartCard title="CO₂e avoided per month" note="From completed trades and your own reuse and recycling" data={d.monthly} tableMode={tableMode}
          columns={[{ key: 'month', label: 'Month', render: (r) => `${mlabel(r.month)} ${r.month.slice(0, 4)}` }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }, { key: 'recoveredKg', label: 'Recovered', right: true, render: (r) => kg(r.recoveredKg) }]}
        >
          <MonthArea data={d.monthly} dataKey="co2SavedKg" name="CO₂e avoided" />
        </ChartCard>
        <ChartCard title="Waste recovered by material" data={d.byMaterial} tableMode={tableMode}
          columns={[{ key: 'material', label: 'Material', render: (r) => MATERIAL_NAMES[r.material] }, { key: 'divertedKg', label: 'Recovered', right: true, render: (r) => kg(r.divertedKg) }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }, { key: 'listings', label: 'Listings', right: true }]}
        >
          <MaterialBarsChart data={d.byMaterial} dataKey="divertedKg" name="Recovered" />
        </ChartCard>
        <Panel title="Recent activity">
          <Table columns={[{ key: 'kind', label: 'Type', render: (r) => ACTIVITY_LABEL[r.kind] }, { key: 'text', label: 'What happened' }, { key: 'at', label: 'When', nowrap: true, render: (r) => ago(r.at) }]} rows={d.recentActivity} empty="Nothing yet. Publish a listing to get started." />
        </Panel>
      </div>

      <Panel title="Latest requests" className="mt-8">
        <Table
          columns={[{ key: 'listing', label: 'Listing' }, { key: 'buyer', label: 'Buyer' }, { key: 'offerPrice', label: 'Offer', right: true, render: (r) => inr(r.offerPrice) }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'at', label: 'When', nowrap: true, render: (r) => ago(r.at) }]}
          rows={d.recentRequests} empty="No buyer has requested your material yet."
        />
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------- buyer
export function BuyerDashboard({ d, role }) {
  const [tableMode, setTableMode] = useState(false);
  const t = d.totals;
  const statusCounts = { pending: t.pending, accepted: t.accepted, completed: t.completed, rejected: t.rejected, cancelled: t.cancelled };
  return (
    <>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat value={t.requests} label="Total requests" />
        <Stat value={t.pending} label="Pending" note="Waiting for the seller" />
        <Stat value={t.accepted} label="Accepted" note="Ready to inspect" />
        <Stat value={t.completed} label="Completed" />
        <Stat value={t.purchases} label="Purchases" />
        <Stat value={inr(t.spend)} label="Spent on reclaimed material" />
        <Stat value={kg(t.materialKg)} label={role === 'Recycler' ? 'Material collected' : 'Material reclaimed'} />
        <Stat value={kg(t.co2SavedKg)} label="CO₂e avoided" note="Saved when each purchase completes" />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link to="/marketplace"><Button size="lg">Search the marketplace</Button></Link>
        <Link to="/requests"><Button variant="secondary" size="lg">My requests</Button></Link>
        <div className="ml-auto"><ModeSwitch tableMode={tableMode} setTableMode={setTableMode} /></div>
      </div>
      <PlatformStrip platform={d.platform} />

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ChartCard title="Requests and purchases by month" note="Last six months" data={d.monthly} tableMode={tableMode}
          columns={[{ key: 'month', label: 'Month', render: (r) => `${mlabel(r.month)} ${r.month.slice(0, 4)}` }, { key: 'requests', label: 'Requests', right: true }, { key: 'purchases', label: 'Purchases', right: true }]}
        >
          <MonthBars data={d.monthly} series={[{ key: 'requests', name: 'Requests sent', color: C.b }, { key: 'purchases', name: 'Purchases completed', color: C.a }]} />
        </ChartCard>
        <ChartCard title="CO₂e avoided per month" data={d.monthly} tableMode={tableMode}
          columns={[{ key: 'month', label: 'Month', render: (r) => `${mlabel(r.month)} ${r.month.slice(0, 4)}` }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }, { key: 'materialKg', label: 'Material', right: true, render: (r) => kg(r.materialKg) }]}
        >
          <MonthArea data={d.monthly} dataKey="co2SavedKg" name="CO₂e avoided" />
        </ChartCard>
        <ChartCard title="Where your requests stand" data={[statusCounts]} tableMode={tableMode}
          columns={[{ key: 'x', label: 'Requests', render: () => 'Count' }, ...Object.keys(statusCounts).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), right: true }))]}
        >
          <StatusDonut counts={statusCounts} />
        </ChartCard>
        <ChartCard title="Material reclaimed by type" data={d.byMaterial} tableMode={tableMode}
          columns={[{ key: 'material', label: 'Material', render: (r) => MATERIAL_NAMES[r.material] }, { key: 'divertedKg', label: 'Reclaimed', right: true, render: (r) => kg(r.divertedKg) }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }]}
        >
          <MaterialBarsChart data={d.byMaterial} dataKey="divertedKg" name="Reclaimed" />
        </ChartCard>
      </div>

      <Panel title="Request history" className="mt-8">
        <Table
          columns={[{ key: 'listing', label: 'Listing', render: materialCell }, { key: 'seller', label: 'Seller' }, { key: 'offerPrice', label: 'Offer', right: true, render: (r) => inr(r.offerPrice) }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'at', label: 'Sent', nowrap: true, render: (r) => ago(r.at) }]}
          rows={d.history} empty="You have not requested anything yet. Search the marketplace to find material."
        />
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------- admin
export function AdminDashboard({ d }) {
  const [tableMode, setTableMode] = useState(false);
  const t = d.totals;
  const listingStatus = [['Active', t.activeListings], ['Reserved', t.reservedListings], ['Sold', t.soldListings], ['Withdrawn', t.withdrawnListings]];
  return (
    <>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat value={t.users} label="Total users" note={`${t.admins} admin${t.admins === 1 ? '' : 's'}`} />
        <Stat value={t.sellers} label="Sellers (companies)" />
        <Stat value={t.buyers} label="Buyers and recyclers" />
        <Stat value={t.listings} label="Listings" note={`${t.activeListings} active`} />
        <Stat value={t.transactions} label="Transactions completed" note={`${inr(t.transactionValue)} traded`} />
        <Stat value={t.pendingRequests} label="Requests awaiting sellers" />
        <Stat value={kg(t.recoveredKg)} label="Waste recovered" note={t.diversionRate != null ? `Diversion rate ${t.diversionRate}%` : undefined} />
        <Stat value={kg(t.co2SavedKg)} label="Platform CO₂e avoided" />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link to="/admin"><Button size="lg">Open moderation</Button></Link>
        <Link to="/resolver"><Button variant="secondary" size="lg">Dispute queue</Button></Link>
        <div className="ml-auto"><ModeSwitch tableMode={tableMode} setTableMode={setTableMode} /></div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ChartCard title="Platform activity by month" note="Last six months" data={d.monthly} tableMode={tableMode}
          columns={[{ key: 'month', label: 'Month', render: (r) => `${mlabel(r.month)} ${r.month.slice(0, 4)}` }, { key: 'users', label: 'New users', right: true }, { key: 'listings', label: 'New listings', right: true }, { key: 'transactions', label: 'Transactions', right: true }]}
        >
          <MonthBars data={d.monthly} series={[{ key: 'users', name: 'New users', color: C.c }, { key: 'listings', name: 'New listings', color: C.b }, { key: 'transactions', name: 'Transactions', color: C.a }]} />
        </ChartCard>
        <ChartCard title="CO₂e avoided per month" data={d.monthly} tableMode={tableMode}
          columns={[{ key: 'month', label: 'Month', render: (r) => `${mlabel(r.month)} ${r.month.slice(0, 4)}` }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }, { key: 'recoveredKg', label: 'Recovered', right: true, render: (r) => kg(r.recoveredKg) }]}
        >
          <MonthArea data={d.monthly} dataKey="co2SavedKg" name="CO₂e avoided" />
        </ChartCard>
        <ChartCard title="Listings by category" data={d.categories} tableMode={tableMode}
          columns={[{ key: 'material', label: 'Category', render: (r) => MATERIAL_NAMES[r.material] }, { key: 'listings', label: 'Listings', right: true }, { key: 'recoveredKg', label: 'Recovered', right: true, render: (r) => kg(r.recoveredKg) }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }]}
        >
          <MaterialBarsChart data={d.categories} dataKey="listings" name="Listings" color={C.b} unit={(v) => `${v} listing${v === 1 ? '' : 's'}`} />
        </ChartCard>
        <ChartCard title="Waste recovered by category" data={d.categories} tableMode={tableMode}
          columns={[{ key: 'material', label: 'Category', render: (r) => MATERIAL_NAMES[r.material] }, { key: 'recoveredKg', label: 'Recovered', right: true, render: (r) => kg(r.recoveredKg) }]}
        >
          <MaterialBarsChart data={d.categories} dataKey="recoveredKg" name="Recovered" />
        </ChartCard>
      </div>

      <p className="mt-6 text-sm text-graphite-500">
        Listings by status: {listingStatus.map(([l, n]) => `${l} ${n}`).join(', ')}.
      </p>

      <Panel title="Recent transactions" className="mt-6">
        <Table
          columns={[{ key: 'listing', label: 'Listing', render: materialCell }, { key: 'seller', label: 'Seller' }, { key: 'buyer', label: 'Buyer' }, { key: 'quantityKg', label: 'Quantity', right: true, render: (r) => kg(r.quantityKg) }, { key: 'co2SavedKg', label: 'CO₂e', right: true, render: (r) => kg(r.co2SavedKg) }, { key: 'at', label: 'When', nowrap: true, render: (r) => ago(r.at) }]}
          rows={d.recentTransactions} empty="No trade has been completed yet."
        />
      </Panel>
    </>
  );
}
