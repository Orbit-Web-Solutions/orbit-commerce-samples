/** Pure JWT helpers (no verification — the API is the verifier). */

/** Seconds of validity below which callers should proactively refresh */
export const REFRESH_MARGIN_S = 60;

/** Decode a JWT's `exp` claim without verifying */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isExpiring(
  token: string,
  marginS: number = REFRESH_MARGIN_S,
): boolean {
  const exp = tokenExpiry(token);
  if (exp === null) return true; // unreadable → treat as expired
  return exp * 1000 - Date.now() < marginS * 1000;
}
