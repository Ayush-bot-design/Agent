export interface UserIdentityLabelInput {
  username: string;
  fullName?: string;
  serialNo?: string;
}

/** Native select options cannot render badges. Put the full serial first to distinguish duplicate names. */
export function userIdentityLabel(user: UserIdentityLabelInput): string {
  return `${user.serialNo?.trim() || 'Serial not assigned'} · ${user.fullName?.trim() || user.username} · @${user.username.replace(/^@+/, '')}`;
}
