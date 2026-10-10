/** Smoke-render the new-material form to HTML and assert the changed defaults.
 *
 * A bare `tsc -b --noEmit` does not catch: (1) stale JSX syntax, (2) react-hook-form
 * APIs called outside a `<FormProvider>`, or (3) a form that renders but never shows
 * the value the new default was meant to display. Rendering to a string is the
 * cheapest way to see all three without a browser.
 */
import { renderToString } from "react-dom/server";
import { BrowserRouter } from "react-router";
import { MaterialFormPage } from "./MaterialFormPage";

const html = renderToString(
  <BrowserRouter>
    <MaterialFormPage editing={null} onDone={() => undefined} />
  </BrowserRouter>,
);

function assert(predicate: boolean, message: string): void {
  if (!predicate) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

// New materials get their five standard numeric fields pre-filled with defaults,
// instead of leaving them blank and forcing the user to type something.
assert(
  html.includes('value="0.00"'),
  `expected Price per unit to start at 0.00, got: ${html.slice(0, 2500)}`,
);

assert(
  html.includes('value="0"'),
  `expected Minimum stock to start at 0, got: ${html.slice(0, 2500)}`,
);

assert(
  html.includes('value="0"'),
  `expected Reorder level to start at 0, got: ${html.slice(0, 2500)}`,
);

assert(
  html.includes('value="0"'),
  `expected Sales tax to start at 0, got: ${html.slice(0, 2500)}`,
);

assert(
  html.includes('value="0"'),
  `expected Purchase tax to start at 0, got: ${html.slice(0, 2500)}`,
);

// Identity fields are still empty for a fresh record (name/code/', with a
// generated code assigned when the record is saved).
assert(
  html.includes('value=""') && !html.includes('value="Auto"'),
  `expected name/code fields to start empty, got: ${html.slice(0, 2500)}`,
);

console.log("ALL DEFAULTS ASSERTIONS PASSED for a new (non-editing) material.");
