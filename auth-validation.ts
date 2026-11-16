/**
 * Authentication validation, username-to-email normalization, and error formatting utilities
 */

export interface ValidationResult {
  isValid: boolean;
  normalizedEmail?: string;
  error?: string;
}

export interface PasswordStrengthResult {
  isValid: boolean;
  score: number; // 0 to 4
  strength: 'weak' | 'fair' | 'good' | 'strong';
  errors: string[];
}

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const DEFAULT_USER_DOMAIN = 'aether.local';

/**
 * Accepts either a standard email address (e.g. "agent@company.com")
 * or a plain username (e.g. "ravi_tech") and returns a normalized email
 * suitable for Supabase Authentication.
 */
export function normalizeUsernameOrEmail(input: string): ValidationResult {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return { isValid: false, error: 'Username or email is required.' };
  }

  // If it contains '@', validate as an email address
  if (trimmed.includes('@')) {
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(trimmed)) {
      return { isValid: false, error: 'Please enter a valid email address.' };
    }
    return { isValid: true, normalizedEmail: trimmed };
  }

  // Otherwise validate as a username (alphanumeric, dots, underscores, hyphens, min 3 chars)
  const usernameRegex = /^[a-z0-9._-]{3,40}$/;
  if (!usernameRegex.test(trimmed)) {
    return {
      isValid: false,
      error:
        'Username must be at least 3 characters (letters, numbers, dots, hyphens, or underscores).',
    };
  }

  return {
    isValid: true,
    normalizedEmail: `${trimmed}@${DEFAULT_USER_DOMAIN}`,
  };
}

export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Email address is required.' };
  }

  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }

  return { isValid: true, normalizedEmail: trimmed.toLowerCase() };
}

export function validatePassword(password: string): PasswordStrengthResult {
  const errors: string[] = [];
  let score = 0;

  if (!password) {
    return {
      isValid: false,
      score: 0,
      strength: 'weak',
      errors: ['Password is required.'],
    };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  } else if (password.length <= MAX_PASSWORD_LENGTH) {
    score += 1;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`);
  }

  if (password.length >= 14) {
    score += 1;
  }

  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) {
    score += 1;
  } else {
    errors.push('Include both uppercase and lowercase letters.');
  }

  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) {
    score += 1;
  } else {
    errors.push('Include at least one number or special symbol.');
  }

  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'weak';
  if (score === 2) strength = 'fair';
  else if (score === 3) strength = 'good';
  else if (score >= 4) strength = 'strong';

  const isValid = password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;

  return {
    isValid,
    score,
    strength,
    errors,
  };
}

export function formatAuthError(error: any): string {
  if (!error) return 'An unexpected error occurred. Please try again.';

  if (typeof error === 'string') return error;

  const msg = error.message || error.error_description || '';

  if (msg.includes('Invalid login credentials')) {
    return 'Invalid username/email or password. Please verify your credentials.';
  }
  if (msg.includes('Email not confirmed')) {
    return 'Email confirmation is enabled in your Supabase settings. Disable "Confirm email" under Authentication -> Providers -> Email in Supabase, or confirm via inbox.';
  }
  if (msg.includes('User already registered')) {
    return 'A user with this username/email is already registered in Supabase.';
  }
  if (msg.includes('Password should be at least')) {
    return 'Password is too short. Supabase requires at least 6 characters.';
  }
  if (msg.includes('rate limit') || msg.includes('Too many requests')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return 'Could not connect to Supabase. Check your project URL and network.';
  }

  return msg || 'Authentication request failed.';
}
