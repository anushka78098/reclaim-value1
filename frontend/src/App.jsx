import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Register from './pages/Register';
import Capture from './pages/Capture';
import Inventory from './pages/Inventory';
import Listings from './pages/Listings';
import Marketplace from './pages/Marketplace';
import Requests from './pages/Requests';
import Assistant from './pages/Assistant';
import Account from './pages/Account';
import Wanted from './pages/Wanted';
import Demand from './pages/Demand';
import Disputes from './pages/Disputes';
import DisputeDetail from './pages/DisputeDetail';
import Resolver from './pages/Resolver';

// the chart library is only downloaded when a dashboard is opened, not on the sign-in page
const Overview = lazy(() => import('./pages/Overview'));
const Impact = lazy(() => import('./pages/Impact'));
const Admin = lazy(() => import('./pages/Admin'));

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="grid min-h-screen place-items-center"><Spinner label="Loading your account" /></div>;
  }
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center"><Spinner label="Loading" /></div>}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Overview />} />
        <Route path="capture" element={<Guard roles={['Company']}><Capture /></Guard>} />
        <Route path="inventory" element={<Guard roles={['Company']}><Inventory /></Guard>} />
        <Route path="listings" element={<Guard roles={['Company']}><Listings /></Guard>} />
        <Route path="marketplace" element={<Marketplace />} />
        <Route path="requests" element={<Guard roles={['Company', 'Buyer', 'Recycler']}><Requests /></Guard>} />
        <Route path="wanted" element={<Guard roles={['Buyer', 'Recycler']}><Wanted /></Guard>} />
        <Route path="disputes" element={<Guard roles={['Company', 'Buyer', 'Recycler']}><Disputes /></Guard>} />
        <Route path="disputes/:id" element={<DisputeDetail />} />
        <Route path="resolver" element={<Guard roles={['Admin']}><Resolver /></Guard>} />
        <Route path="demand" element={<Guard roles={['Company']}><Demand /></Guard>} />
        <Route path="impact" element={<Impact />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="admin" element={<Guard roles={['Admin']}><Admin /></Guard>} />
        <Route path="account" element={<Account />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
