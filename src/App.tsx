import { useMemo, useState } from 'react';
import type { InstallationSite } from './utils/deployment-logic';
import { useWorkspace } from './lib/workspace-store';
import { FlashProvider } from './lib/flash';
import { AppShell, type TabId } from './components/AppShell';
import { Dashboard } from './components/Dashboard';
import { SignIn } from './components/SignIn';
import { SiteReviewDialog } from './components/SiteReviewDialog';
import { Workspace } from './components/Workspace';
import { Profile } from './components/Profile';
import { Reports } from './components/Reports';
import { Deployment } from './components/Deployment';

function Console() {
  const { profile, sites } = useWorkspace();
  const [tab, setTab] = useState<TabId>('dashboard');
  const [reviewSiteId, setReviewSiteId] = useState<string | null>(null);

  // Re-read the site from the store so the dialog reflects reservations immediately.
  const currentSite = useMemo(
    () => (reviewSiteId ? (sites.find((site) => site.id === reviewSiteId) ?? null) : null),
    [reviewSiteId, sites],
  );

  if (!profile) return <SignIn />;

  return (
    <AppShell tab={tab} onTabChange={setTab}>
      {tab === 'dashboard' ? (
        <Dashboard
          onOpenSite={(site: InstallationSite) => setReviewSiteId(site.id)}
          onOpenWorkspace={() => setTab('workspace')}
        />
      ) : null}
      {tab === 'workspace' ? <Workspace onBrowseSites={() => setTab('dashboard')} /> : null}
      {tab === 'profile' ? <Profile /> : null}
      {tab === 'reports' ? <Reports /> : null}
      {tab === 'deployment' ? <Deployment /> : null}

      <SiteReviewDialog
        site={currentSite}
        onClose={() => setReviewSiteId(null)}
        onOpenWorkspace={() => setTab('workspace')}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <FlashProvider>
      <Console />
    </FlashProvider>
  );
}
