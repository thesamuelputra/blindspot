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
import { LoginGate } from '@/components/auth/LoginGate';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { CommandPage } from '@/pages/CommandPage';
import { WorldPage } from '@/pages/WorldPage';
import { WallPage } from '@/pages/WallPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { CamsPage } from '@/pages/CamsPage';
import { SystemPage } from '@/pages/SystemPage';
import { AnalystPage } from '@/pages/AnalystPage';
import { HazardPage } from '@/pages/HazardPage';
import { SkiesSeasPage } from '@/pages/SkiesSeasPage';
import { GroundPage } from '@/pages/GroundPage';
import { SignalsPage } from '@/pages/SignalsPage';
import { InfraPage } from '@/pages/InfraPage';
import { PulsePage } from '@/pages/PulsePage';
import { EnviroPage } from '@/pages/EnviroPage';
import { SpacePage } from '@/pages/SpacePage';
import { AlertToasts } from '@/components/alerts/AlertToasts';

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
        <AlertToasts />
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

const page = (path: string, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  indexRoute,
  commandRoute,
  page('/hazard', HazardPage),
  page('/skies-seas', SkiesSeasPage),
  page('/ground', GroundPage),
  page('/signals', SignalsPage),
  page('/infrastructure', InfraPage),
  page('/pulse', PulsePage),
  page('/environment', EnviroPage),
  page('/space', SpacePage),
  page('/analyst', AnalystPage),
  page('/incidents', IncidentsPage),
  page('/world', WorldPage),
  page('/cams', CamsPage),
  page('/system', SystemPage),
  page('/wall', WallPage),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
