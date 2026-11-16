/** Validates Google Maps short links before the server makes an outbound request. */
export function parseGoogleMapsShortLink(input: unknown): URL | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;

  try {
    const url = new URL(/^https:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

    const isMapsAppLink = url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1;
    const isLegacyMapsLink =
      url.hostname === 'goo.gl' && /^\/maps\/[a-z0-9/_-]+$/i.test(url.pathname);
    return isMapsAppLink || isLegacyMapsLink ? url : null;
  } catch {
    return null;
  }
}
