import type { InstallationSite } from './deployment-logic';

/** Read-only display metadata, never a workflow/site mutation object. */
export interface CompletedSiteDetails {
  id: string;
  remark: string;
  hostname: string;
  documents: Array<{ id: string; name: string; hasOriginal: boolean }>;
  seal: { verificationId: string; matchScore: number } | null;
}
export function completedSiteDetails(site: InstallationSite): CompletedSiteDetails {
  const seal = site.biometricCompletionSeal;
  return {
    id: site.id,
    remark: site.remark || site.notes || '',
    hostname: site.hostnameVerification?.hostname || site.sampleValidHostname || '',
    documents: (site.documents || []).map((doc) => ({
      id: doc.id,
      name: doc.name,
      hasOriginal: Boolean(doc.storagePath),
    })),
    seal: seal?.verified
      ? { verificationId: seal.verificationId, matchScore: seal.matchScore }
      : null,
  };
}
