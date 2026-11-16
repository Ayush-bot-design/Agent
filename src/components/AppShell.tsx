import type { ReactNode } from 'react';
import { useWorkspace } from '../lib/workspace-store';
import { Badge, cx } from './ui';
import { Icon } from './icons';

export type TabId = 'dashboard' | 'workspace' | 'profile' | 'reports' | 'deployment';

export const TABS: Array<{ id: TabId; label: string; short: string; icon: string }> = [
  { id: 'dashboard', label: 'District worklist', short: 'Sites', icon: 'sites' },
  { id: 'workspace', label: 'Active site', short: 'Workspace', icon: 'workspace' },
  { id: 'profile', label: 'Agent profile', short: 'Profile', icon: 'profile' },
  { id: 'reports', label: 'Reports', short: 'Reports', icon: 'reports' },
  { id: 'deployment', label: 'Deployment', short: 'Deploy', icon: 'deployment' },
];

export function AppShell({
  tab,
  onTabChange,
  children,
}: {
  tab: TabId;
  onTabChange: (tab: TabId) => void;
  children: ReactNode;
}) {
  const { profile, activeSite, signOut } = useWorkspace();
  const initials = (profile?.fullName || profile?.username || 'Agent')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div className="min-h-screen pb-24 sm:pb-10">
      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/app-icon.svg"
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl ring-1 ring-slate-900/10"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-tight text-slate-900">
                UP Tender Deployment Console
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {profile?.operatingZone ? `${profile.operatingZone} zone` : 'Field operations'} ·{' '}
                {profile?.serialNo || 'serial pending'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge tone="slate" className="hidden sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Demo data
            </Badge>
            <div className="hidden items-center gap-2 rounded-xl bg-slate-900/[0.05] px-2.5 py-1.5 sm:flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-bold text-white">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{profile?.fullName}</p>
                <p className="truncate text-[10px] text-slate-500">@{profile?.userKey}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800"
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>

        <nav className="mx-auto hidden w-full max-w-7xl gap-1 px-4 pb-2 sm:flex sm:px-6">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={cx(
                'inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                tab === item.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-900/5 hover:text-slate-900',
              )}
            >
              <Icon name={item.icon} className="h-3.5 w-3.5" />
              {item.label}
              {item.id === 'workspace' && activeSite ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/70 bg-white/85 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur-xl sm:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-between">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={cx(
                'relative flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1 text-[10px] font-semibold transition',
                tab === item.id ? 'text-slate-900' : 'text-slate-500',
              )}
            >
              <span
                className={cx(
                  'flex h-7 w-10 items-center justify-center rounded-lg transition',
                  tab === item.id ? 'bg-slate-900 text-white' : 'bg-transparent',
                )}
              >
                <Icon name={item.icon} className="h-4 w-4" />
              </span>
              {item.short}
              {item.id === 'workspace' && activeSite ? (
                <span className="absolute top-1 right-3 h-1.5 w-1.5 rounded-full bg-emerald-500" />
              ) : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
