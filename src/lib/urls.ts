/**
 * Canonical URL resolution utility.
 * Safe for both server-side execution and client-side fallback.
 * Never use `window.location.origin` inside server-side code.
 */
export function getBaseUrl(): string {
  // 1. Explicit canonical URL (production custom domain)
  if (process.env.NEXT_PUBLIC_SITE_URL && process.env.NEXT_PUBLIC_SITE_URL.trim() !== "") {
    return process.env.NEXT_PUBLIC_SITE_URL.trim().replace(/\/+$/, "");
  }

  // 2. Vercel deployment URL
  if (process.env.VERCEL_URL) {
    const host = process.env.VERCEL_URL.trim().replace(/\/+$/, "");
    return host.startsWith("http") ? host : `https://${host}`;
  }

  // 3. Client-side fallback if running in browser
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  // 4. Default local development fallback
  return "http://localhost:3000";
}

/**
 * Returns the join URL encoded into QR codes:
 * e.g. https://your-domain.com/join/ABCD
 */
export function getJoinUrl(code: string): string {
  return `${getBaseUrl()}/join/${code.toUpperCase()}`;
}
