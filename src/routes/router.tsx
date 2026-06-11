import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { Authenticated, Unauthenticated, AuthLoading } from 'convex/react';
import { TopBar } from '@/components/shell/TopBar';
import { NavRail } from '@/components/shell/NavRail';
import { PagePlaceholder } from '@/components/shell/PagePlaceholder';
import { LoginGate } from '@/components/auth/LoginGate';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { CommandPage } from '@/pages/CommandPage';
import { WorldPage } from '@/pages/WorldPage';
import { WallPage } from '@/pages/WallPage';

function Shell() {
  return (
    <>
      <AuthLoading>
        <div
          style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="microlabel">ESTABLISHING UPLINK…</span>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <LoginGate />
      </Unauthenticated>
      <Authenticated>
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <TopBar />
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <NavRail />
            <main style={{ flex: 1, position: 'relative', minWidth: 0, background: 'var(--bg-0)' }}>
              <Outlet />
            </main>
          </div>
        </div>
        <CommandPalette />
      </Authenticated>
    </>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/command' });
  },
});

const commandRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/command',
  component: CommandPage,
});

const placeholder = (path: string, code: string, note?: string) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => <PagePlaceholder code={code} note={note} />,
  });

const routeTree = rootRoute.addChildren([
  indexRoute,
  commandRoute,
  placeholder('/hazard', 'HAZARD // SEISMIC · WX · FIRE · TSUNAMI'),
  placeholder('/skies-seas', 'SKIES & SEAS // AIR · MARINE'),
  placeholder('/ground', 'GROUND // ROADS · TRANSIT · POWER'),
  placeholder('/signals', 'SIGNALS // RF · APRS · SONDES'),
  placeholder('/infrastructure', 'INFRASTRUCTURE // GRID · NET · CELLS'),
  placeholder('/pulse', 'PULSE // NEWS · CIVIC · EVENTS'),
  placeholder('/environment', 'ENVIRONMENT // AQ · HYDRO · OCEAN'),
  placeholder('/space', 'SPACE // SATS · LAUNCHES · AURORA'),
  placeholder('/analyst', 'ANALYST // NL CONSOLE + INTSUM', 'BRAIN ARRIVES IN PHASE 4'),
  placeholder('/incidents', 'INCIDENTS // WORKSPACE', 'BRAIN ARRIVES IN PHASE 4'),
  createRoute({ getParentRoute: () => rootRoute, path: '/world', component: WorldPage }),
  placeholder('/cams', 'CAMS // LIVE MEDIA WALL'),
  placeholder('/system', 'SYSTEM // FEED HEALTH + OPS BOARD'),
  createRoute({ getParentRoute: () => rootRoute, path: '/wall', component: WallPage }),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
