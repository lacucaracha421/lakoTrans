// @ts-check
const { createHash, randomUUID } = require("node:crypto");

/** Allocate at the page/probe lifecycle, never at HTTP dispatch.
 * @template {Record<string, unknown>} T
 * @param {T} options
 * @param {boolean} [independent]
 */
function withApiConversation(options, independent = false) {
  if (!options.apiSessionHeaderName) return options;
  const page = options.pageId || options.imagePath;
  const id = independent
    ? randomUUID()
    : options.apiConversationId ||
      (options.apiConversationSeed && page
        ? createHash("sha256")
            .update(`${options.apiConversationSeed}\0${page}`)
            .digest("hex")
        : randomUUID());
  return { ...options, apiConversationId: id };
}

/** @param {Record<string, unknown>} options @param {Record<string, string>} headers */
function applyApiConnectionHeaders(options, headers) {
  const result = { ...headers };
  if (
    options.apiUserAgent &&
    !Object.keys(result).some((key) => key.toLowerCase() === "user-agent")
  ) {
    result["User-Agent"] = String(options.apiUserAgent);
  }
  const name = String(options.apiSessionHeaderName || "");
  if (!name) return result;
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
    /^(?:authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie|set-cookie|host|content-type|content-length|connection|transfer-encoding|te|trailer|upgrade|expect|user-agent|accept|accept-encoding)$/i.test(
      name,
    ) ||
    /(?:-api-key|-token)$/i.test(name) ||
    Object.keys(result).some((key) => key.toLowerCase() === name.toLowerCase())
  ) {
    throw new Error("Invalid or conflicting API session header name.");
  }
  if (!options.apiConversationId)
    throw new Error("API conversation scope is missing.");
  result[name] = String(options.apiConversationId);
  return result;
}

module.exports = { withApiConversation, applyApiConnectionHeaders };
