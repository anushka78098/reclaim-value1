import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import Notifications from './Notifications';

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  capture: 'M4 7h3l2-3h6l2 3h3v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  inventory: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  listings: 'M3 5h12l6 7-6 7H3zM15 12h.01',
  market: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5.2-5.2',
  requests: 'M4 4h16v12H8l-4 4zM8 9h8M8 12h5',
  impact: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  assistant: 'M12 3a9 9 0 0 1 0 18H3l2.6-2.6A9 9 0 0 1 12 3zM8 12h.01M12 12h.01M16 12h.01',
  admin: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
  wanted: 'M12 21s-7-4.4-7-10a7 7 0 0 1 14 0c0 5.6-7 10-7 10zM12 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  demand: 'M3 10v4h3l6 4V6L6 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  dispute: 'M12 3v18M7 21h10M4 7h16M4 7l-2.5 6a3 3 0 0 0 5 0zM20 7l-2.5 6a3 3 0 0 0 5 0z',
};

const NAV = {
  Company: [
    ['/', 'Overview', 'home'], ['/capture', 'Capture', 'capture'], ['/inventory', 'Inventory', 'inventory'],
    ['/listings', 'Listings', 'listings'], ['/requests', 'Requests', 'requests'], ['/disputes', 'Disputes', 'dispute'], ['/demand', 'Buyer demand', 'demand'],
    ['/impact', 'Impact', 'impact'],
    ['/assistant', 'Assistant', 'assistant'],
  ],
  Buyer: [
    ['/', 'Overview', 'home'], ['/marketplace', 'Marketplace', 'market'], ['/requests', 'My requests', 'requests'],
    ['/wanted', 'Wanted alerts', 'wanted'], ['/disputes', 'Disputes', 'dispute'], ['/impact', 'Impact', 'impact'], ['/assistant', 'Assistant', 'assistant'],
  ],
  Admin: [
    ['/', 'Overview', 'home'], ['/admin', 'Moderation', 'admin'], ['/resolver', 'Resolver', 'dispute'], ['/marketplace', 'Marketplace', 'market'],
    ['/impact', 'Impact', 'impact'], ['/assistant', 'Assistant', 'assistant'],
  ],
};
NAV.Recycler = NAV.Buyer;
// the five most used destinations for the phone tab bar
const MOBILE = {
  Company: ['/', '/capture', '/inventory', '/requests', '/assistant'],
  Buyer: ['/', '/marketplace', '/requests', '/wanted', '/assistant'],
  Recycler: ['/', '/marketplace', '/requests', '/wanted', '/assistant'],
};

function Icon({ name }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Logo({ dark = false }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <path d="M4 8h18l6 8-6 8H4z" fill="#F2C230" />
        <circle cx="21" cy="16" r="2.5" fill="#1F2427" />
      </svg>
      <span className={`condensed text-xl font-extrabold ${dark ? 'text-white' : 'text-graphite-900'}`}>Reclaim Value</span>
    </span>
  );
}

const linkClass = ({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold ${
  isActive ? 'bg-verdigris-700 text-white' : 'text-verdigris-50/80 hover:bg-verdigris-700/60 hover:text-white'}`;

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = NAV[user.role] || NAV.Buyer;
  const mobile = MOBILE[user.role] ? nav.filter(([to]) => MOBILE[user.role].includes(to)) : nav;

  return (
    <div className="min-h-screen md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden w-60 shrink-0 flex-col bg-verdigris-800 px-3 py-5 md:flex">
        <div className="flex items-center justify-between pl-2"><Logo dark /><Notifications dark /></div>
        <nav aria-label="Main" className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={linkClass}><Icon name={icon} />{label}</NavLink>
          ))}
        </nav>
        <div className="border-t border-verdigris-700 px-2 pt-4 text-sm">
          <NavLink to="/account" className="block font-semibold text-white hover:underline">{user.name}</NavLink>
          <p className="text-verdigris-100/70">{user.role}{user.city ? `, ${user.city}` : ''}</p>
          <button onClick={logout} className="mt-2 text-verdigris-100/80 hover:text-white hover:underline">Sign out</button>
        </div>
      </aside>

      <header className="flex items-center justify-between border-b border-slab-300 bg-white px-4 py-3 md:hidden">
        <Logo />
        <div className="flex items-center gap-2">
          <Notifications />
          <NavLink to="/account" className="text-sm font-semibold text-verdigris-700">{user.name.split(' ')[0]}</NavLink>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-8">
        <Outlet />
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slab-300 bg-white md:hidden">
        {mobile.map(([to, label, icon]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-verdigris-700' : 'text-graphite-500'}`}
          >
            <Icon name={icon} />
            {label.replace('My requests', 'Requests').replace('Wanted alerts', 'Wanted')}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
