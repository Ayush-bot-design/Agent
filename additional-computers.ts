export const MAX_ADDITIONAL_COMPUTERS = 50;
export const MIN_ADDITIONAL_COMPUTER_REMARK = 10;
export const MAX_ADDITIONAL_COMPUTER_REMARK = 500;

export interface AddComputerInput {
  remark: string;
  expectedCount: number;
  /** Stable across retries of the same user action. */
  requestId: string;
}

export function additionalComputerRemarkError(remark: string): string | null {
  const length = remark.trim().length;
  return length < MIN_ADDITIONAL_COMPUTER_REMARK || length > MAX_ADDITIONAL_COMPUTER_REMARK
    ? 'Explain the extra computer in 10–500 characters (for example, an additional PC found in the accounts office).'
    : null;
}
