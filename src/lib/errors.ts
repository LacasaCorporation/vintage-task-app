/**
 * Convex hands back anything thrown inside a function wrapped in request
 * metadata, for example:
 *
 *   [CONVEX M(firms:createFirm)] [Request ID: 7f3a…] Server Error Uncaught
 *   Error: “sabood” already owns a firm. at handler (…/firms.ts:138:8) Called
 *   by client
 *
 * Only a `ConvexError` is meant to reach a user, and the backend still throws
 * plain `Error`s, so every validation message arrives looking like the above.
 * The sentence a person needs is in the middle — lift it out so a toast reads
 * "“sabood” already owns a firm." instead of a request id and a file path.
 * Anything we can't parse is returned untouched, so a clean `ConvexError`
 * message (or a non-Convex string) passes through exactly as written.
 */
const SERVER_ERROR = "Server Error";

/** The user's sentence from a wrapped Convex error, or null if not wrapped. */
export function cleanConvexMessage(raw: string): string | null {
  const start = raw.indexOf(SERVER_ERROR);
  if (start === -1) return null;
  let rest = raw.slice(start + SERVER_ERROR.length);
  rest = rest
    .replace(/^\s*Uncaught Error:\s*/, "")
    // the non-uncaught variant reads "Server Error: <message>"
    .replace(/^\s*:\s*/, "")
    .trim();
  // drop the trailing source location and caller note the wrapper appends
  for (const tail of [" at handler", " Called by client"]) {
    const at = rest.lastIndexOf(tail);
    if (at !== -1) rest = rest.slice(0, at);
  }
  rest = rest.trim();
  // the wrapper renders the original message as a quoted string
  if (rest.length > 1 && rest.startsWith('"') && rest.endsWith('"')) {
    rest = rest.slice(1, -1).trim();
  }
  return rest.length > 0 ? rest.replace(/\s+/g, " ") : null;
}

/** A short, human message from anything that was thrown. */
export function messageFrom(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const clean = cleanConvexMessage(raw);
  if (clean !== null) return clean;
  return raw.trim().length > 0 ? raw.trim() : fallback;
}
