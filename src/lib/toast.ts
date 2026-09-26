import { toast as sonnerToast } from "sonner";
import { cleanConvexMessage } from "@/lib/errors";

/**
 * Sonner's toast, with one change: an error message is unwrapped first, so a
 * rejected Convex mutation tells the user what actually went wrong instead of
 * printing the request id and server file path. Everything else is passed
 * straight through.
 *
 * `src/convex` still throws plain `Error`s rather than `ConvexError`s, which
 * is what makes those wrappers necessary — fixing that at the source is the
 * better long-term change.
 */
type ErrorArgs = Parameters<typeof sonnerToast.error>;

function clean(message: ErrorArgs[0]): ErrorArgs[0] {
  if (typeof message !== "string") return message;
  const unwrapped = cleanConvexMessage(message);
  if (unwrapped === null) return message;
  // keep the technical detail reachable without putting it on screen
  console.warn("Convex error shown to the user:", message);
  return unwrapped;
}

export const toast = {
  ...sonnerToast,
  error: (message: ErrorArgs[0], data?: ErrorArgs[1]) =>
    sonnerToast.error(clean(message), data),
};
