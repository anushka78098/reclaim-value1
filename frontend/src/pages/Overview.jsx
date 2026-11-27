import { api } from '../api';
import { useAuth } from '../auth';
import Chat from '../components/Chat';
import { AdminDashboard, BuyerDashboard, SellerDashboard } from '../components/Dashboards';
import { ErrorNote, PageHeader, Spinner, useAutoRefresh, useLoad } from '../components/ui';

const SUGGESTIONS = {
  Company: ['Show my inventory', 'How much CO₂ have we saved?', 'Any pending requests?'],
  Buyer: ['Steel under 30k near me', 'Bricks in good condition within 40 km', 'How does inspection work?'],
  Recycler: ['Glass near me', 'Concrete rubble within 50 km', 'Should I recycle cracked tiles?'],
  Admin: ['Platform impact summary', 'How is the price estimated?'],
};

export default function Overview() {
  const { user } = useAuth();
  // Always the signed-in account's own numbers; refreshed when you return to the tab and every 30 s,
  // so a request answered by another account shows up here without a manual reload.
  const { data, error, loading, reload } = useLoad(() => api('/analytics/dashboard'), []);
  useAutoRefresh(reload, 30000);
  const first = user.name.split(' ')[0];
  return (
    <>
      <PageHeader title={`Hello, ${first}`}>
        {user.role === 'Company' && `${user.organization || 'Your company'}${user.city ? ` in ${user.city}` : ''}.`}
        {(user.role === 'Buyer' || user.role === 'Recycler') && `Reclaimed material near ${user.city || 'you'}.`}
        {user.role === 'Admin' && 'Platform health at a glance.'}
      </PageHeader>
      {loading && !data && <Spinner label="Loading your dashboard" />}
      <ErrorNote>{error}</ErrorNote>
      {data?.role === 'seller' && <SellerDashboard d={data} />}
      {data?.role === 'buyer' && <BuyerDashboard d={data} role={user.role} />}
      {data?.role === 'admin' && <AdminDashboard d={data} />}
      <section className="mt-10">
        <h2 className="mb-3 text-xl font-bold">Ask the assistant</h2>
        <Chat compact suggestions={SUGGESTIONS[user.role]} />
      </section>
    </>
  );
}
