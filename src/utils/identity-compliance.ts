import type { UserProfile } from './deployment-logic';

export const LEGAL_PROOF_TYPES = [
  'Aadhaar',
  'PAN Card',
  'Voter ID',
  'Driving License',
  'Govt Tech ID',
] as const;
export const MAX_IDENTITY_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Read-time assessment only: never rewrites legacy records or treats an upload as verification. */
export function getIdentityCompliance(
  profile: Pick<UserProfile, 'address' | 'legalProofType' | 'legalProofNumber' | 'legalProofDoc'>,
) {
  const reasons: string[] = [];
  if (!profile.address?.trim()) reasons.push('Address is missing.');
  if (!profile.legalProofNumber?.trim()) reasons.push('Proof number is missing.');
  else if (/x{3,}|^(unknown|n\/?a|not provided)$/i.test(profile.legalProofNumber))
    reasons.push('Masked or placeholder number requires review; this is not a finding of fraud.');
  const doc = profile.legalProofDoc;
  if (!doc?.fileData) reasons.push('Original evidence file is missing.');
  if (
    doc &&
    (doc.evidenceVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(doc.evidenceSha256 || '') ||
      !Number.isFinite(Date.parse(doc.uploadedAt)))
  ) {
    reasons.push('Legacy evidence metadata requires review.');
  }
  const verified =
    reasons.length === 0 &&
    doc?.verified === true &&
    doc.verificationVersion === 1 &&
    Boolean(doc.verifiedBy) &&
    Number.isFinite(Date.parse(doc.verifiedAt || ''));
  if (doc?.verified && !verified)
    reasons.push('Legacy verification claim has no current authorized verification record.');
  return {
    status: verified ? 'verified' : reasons.length ? 'review_required' : 'pending_verification',
    reasons,
  } as const;
}
