import { isValidCustomHeadersJson } from "./ipcSchemaValidation";

const RESERVED =
  /^(?:authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie|set-cookie|host|content-type|content-length|connection|transfer-encoding|te|trailer|upgrade|expect|user-agent|accept|accept-encoding)$/i;

export function apiSessionHeaderError(profile: {
  sessionHeaderEnabled?: boolean;
  sessionHeaderName?: string;
  customHeadersJson?: string;
}): string | null {
  if (!profile.sessionHeaderEnabled) return null;
  const name = profile.sessionHeaderName ?? "";
  if (
    !name ||
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
    RESERVED.test(name) ||
    /(?:-api-key|-token)$/i.test(name)
  ) {
    return "Use a valid non-authentication, non-transport session header name.";
  }
  const json = profile.customHeadersJson?.trim();
  if (!json) return null;
  if (!isValidCustomHeadersJson(json)) return "Invalid custom headers JSON.";
  return Object.keys(JSON.parse(json)).some(
    (key) => key.toLowerCase() === name.toLowerCase(),
  )
    ? "The session header conflicts with a custom header."
    : null;
}
