# Site Selection Fresh-Read Fix

This document preserves the uploaded patch as a Markdown diff.

``` diff
diff --git a/server.ts b/server.ts
index 0dba92a..761950d 100644
--- a/server.ts
+++ b/server.ts
@@ -744,7 +744,7 @@ async function syncSitesToSupabaseIfConfigured(
   }
 }
 
-async function loadAuthoritativeSites(body?: any): Promise<{
+async function loadAuthoritativeSites(body?: any, requireLiveRead = false): Promise<{
   sites: InstallationSite[];
   syncedWithSupabaseTable: boolean;
 }> {
@@ -803,8 +803,9 @@ async function loadAuthoritativeSites(body?: any): Promise<{
         }
       }
     } catch {
-      // Fallback to local store
+      // A strict read must not silently use a potentially stale local copy.
     }
+    if (requireLiveRead) throw new Error('Unable to read the current site status.');
   }
 
   return { sites: localSites, syncedWithSupabaseTable: false };
@@ -1579,9 +1580,13 @@ Return strict JSON:
   app.get(
     '/api/supabase/sites',
     requireRole(['admin', 'agent']),
-    async (_req, res) => {
-      const result = await loadAuthoritativeSites();
-      res.json(result);
+    async (req, res) => {
+      try {
+        const result = await loadAuthoritativeSites(undefined, req.query.fresh === '1');
+        res.json(result);
+      } catch {
+        res.status(503).json({ error: 'Unable to read the current site status.' });
+      }
     }
   );
 
diff --git a/src/components/SessionDashboard.tsx b/src/components/SessionDashboard.tsx
index b46560a..81db1f1 100644
--- a/src/components/SessionDashboard.tsx
+++ b/src/components/SessionDashboard.tsx
@@ -35,6 +35,7 @@ import {
   fetchIsolatedUserProfile,
   saveIsolatedUserProfile,
   fetchProductionSites,
+  fetchFreshProductionSites,
   getCachedProductionSites,
   claimTenderSite,
   updateClaimedTenderSite,
@@ -101,6 +102,7 @@ export const SessionDashboard: React.FC<SessionDashboardProps> = ({
   const [claimErrorMsg, setClaimErrorMsg] = useState<string | null>(null);
   const [completionSuccessMsg, setCompletionSuccessMsg] = useState<string | null>(null);
   const [isClaimingId, setIsClaimingId] = useState<string | null>(null);
+  const siteSelectionPending = useRef(false);
 
   const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
   const [softwareInstalled, setSoftwareInstalled] = useState(false);
@@ -321,46 +323,32 @@ export const SessionDashboard: React.FC<SessionDashboardProps> = ({
   };
 
   const handleSelectAndReserveSite = async (siteToClaim: InstallationSite) => {
+    if (siteSelectionPending.current) return;
+    siteSelectionPending.current = true;
     setClaimErrorMsg(null);
-    const targetId = String(siteToClaim.id);
-    const targetCode = siteToClaim.siteCode;
-    setIsClaimingId(targetId);
-
-    // 1. CRITICAL: Fetch FRESH data from server and use it DIRECTLY
-    const fetchRes = await fetchProductionSites();
-    const freshSites = fetchRes.sites || [];
-    
-    if (fetchRes.sites) {
-      setSites(fetchRes.sites);
-    } else {
+    setIsClaimingId(String(siteToClaim.id));
+
+    let freshSites: InstallationSite[];
+    try {
+      freshSites = await fetchFreshProductionSites();
+    } catch {
       setClaimErrorMsg('Failed to sync with server. Please check your connection and try again.');
       setIsClaimingId(null);
+      siteSelectionPending.current = false;
       return;
     }
-    
-    // 2. DEEP SEARCH: Find the site by ID or Site Code in the fresh batch
-    const authoritativeSite = freshSites.find((s) => 
-      String(s.id) === targetId || (targetCode && s.siteCode === targetCode)
-    );
-
-    const site = authoritativeSite || siteToClaim;
+    setSites(freshSites);
+    const site = freshSites.find((s) => String(s.id) === String(siteToClaim.id));
     setIsClaimingId(null);
+    siteSelectionPending.current = false;
+    if (!site) {
+      setClaimErrorMsg('This installation is no longer available.');
+      return;
+    }
 
     const ownerKey = site.reservedByUser ? normalizeUserKey(site.reservedByUser) : '';
-    const completedOwner = site.completedByUser ? normalizeUserKey(site.completedByUser) : '';
-
-    // 3. AUTHORITATIVE STATUS CHECK: Return early if server says it's not available
-    // Also check for evidence of completion (Seal) regardless of status string
-    const hasEvidenceOfCompletion = Boolean(site.biometricCompletionSeal?.verified);
-
-    if (site.status === 'completed' || hasEvidenceOfCompletion) {
-      if (completedOwner === userKey) {
-        openSiteWorkspace(site);
-      } else {
-        setClaimErrorMsg(
-          `This installation is already completed${completedOwner ? ` by @${completedOwner}` : ''}.`
-        );
-      }
+    if (site.status === 'completed' || site.biometricCompletionSeal?.verified) {
+      setClaimErrorMsg('This installation is already completed.');
       return;
     }
 
@@ -384,9 +372,10 @@ export const SessionDashboard: React.FC<SessionDashboardProps> = ({
     }
 
     // 4. If this user already has another site in progress -> enforce 1 site at a time
-    if (myActiveReservedSite && myActiveReservedSite.id !== site.id) {
+    const freshActiveSite = getActiveSiteForUser(freshSites, userKey);
+    if (freshActiveSite && freshActiveSite.id !== site.id) {
       setClaimErrorMsg(
-        `You already have 1 active installation in progress at "${myActiveReservedSite.clientName}" (${myActiveReservedSite.district}). Complete it first before selecting another site.`
+        `You already have 1 active installation in progress at "${freshActiveSite.clientName}" (${freshActiveSite.district}). Complete it first before selecting another site.`
       );
       return;
     }
diff --git a/src/lib/fresh-sites.test.ts b/src/lib/fresh-sites.test.ts
new file mode 100644
index 0000000..3a1f9ff
--- /dev/null
+++ b/src/lib/fresh-sites.test.ts
@@ -0,0 +1,26 @@
+import { test, afterEach } from 'node:test';
+import assert from 'node:assert/strict';
+import { fetchFreshProductionSites } from './supabase.ts';
+
+const originalFetch = globalThis.fetch;
+afterEach(() => { globalThis.fetch = originalFetch; });
+
+test('fresh site read disables caching and returns the server response', async () => {
+  globalThis.fetch = (async (url, options) => {
+    assert.equal(url, '/api/supabase/sites?fresh=1');
+    assert.equal(options?.cache, 'no-store');
+    return new Response(JSON.stringify({ sites: [{ id: '1', status: 'completed' }] }));
+  }) as typeof fetch;
+  assert.equal((await fetchFreshProductionSites())[0].status, 'completed');
+});
+
+test('fresh site read fails closed on server errors, network errors, or invalid data', async () => {
+  for (const response of [
+    () => Promise.resolve(new Response('', { status: 503 })),
+    () => Promise.reject(new Error('offline')),
+    () => Promise.resolve(new Response(JSON.stringify({}))),
+  ]) {
+    globalThis.fetch = response as typeof fetch;
+    await assert.rejects(fetchFreshProductionSites());
+  }
+});
diff --git a/src/lib/supabase.ts b/src/lib/supabase.ts
index 2433a4f..1d13bf0 100644
--- a/src/lib/supabase.ts
+++ b/src/lib/supabase.ts
@@ -483,6 +483,19 @@ export async function fetchProductionSites(): Promise<{
   return { sites: getCachedProductionSites(), syncedWithSupabaseTable: false };
 }
 
+/** A fail-closed read for decisions that may start camera or location access. */
+export async function fetchFreshProductionSites(): Promise<InstallationSite[]> {
+  const res = await fetch('/api/supabase/sites?fresh=1', {
+    headers: getAuthHeaders(),
+    cache: 'no-store',
+  });
+  if (!res.ok) throw new Error('Failed to sync with server.');
+  const data = await res.json();
+  if (!Array.isArray(data.sites)) throw new Error('Invalid site response.');
+  saveCachedProductionSites(data.sites);
+  return data.sites;
+}
+
 /**
  * Synchronizes installation sites via the admin-authorized backend endpoint.
  */
```
