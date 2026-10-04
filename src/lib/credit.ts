/**
 * Credit limits: how much a contact is allowed to owe before new paperwork is
 * refused.
 *
 * The same arithmetic has to run on the server, which is the authority that
 * refuses the save, and in the form, which shows the headroom as it is typed.
 * Keeping it here means the number the form promises is the number the server
 * enforces.
 */

const cents = (n: number) => Math.round(n * 100) / 100;

export type CreditState = {
  /** The ceiling, when one is set. */
  limit: number | undefined;
  /** What is already owed — owed *to* a supplier, owed *by* a customer. */
  outstanding: number;
  /** What is still available to spend. Negative once the limit is passed. */
  available: number | undefined;
  /** True once the outstanding balance has reached or passed the limit. */
  atLimit: boolean;
  /** True once it has passed it. */
  overLimit: boolean;
  /** How far past the limit a proposed document would push it. */
  overBy: number;
};

/**
 * Where a contact stands right now, and where a proposed document of
 * `proposed` would leave them.
 */
export function creditState(
  limit: number | undefined,
  outstanding: number,
  proposed = 0,
): CreditState {
  const owed = cents(outstanding);
  const after = cents(owed + proposed);
  const hasLimit = limit !== undefined && limit > 0;
  return {
    limit: hasLimit ? cents(limit) : undefined,
    outstanding: owed,
    available: hasLimit ? cents((limit as number) - owed) : undefined,
    atLimit: hasLimit ? owed >= (limit as number) : false,
    overLimit: hasLimit ? after > (limit as number) : false,
    overBy: hasLimit ? cents(Math.max(0, after - (limit as number))) : 0,
  };
}

/**
 * The message shown when a document is refused, naming the contact, what is
 * owed and what the ceiling is — so the refusal explains itself.
 */
export function creditRefusalMessage(
  who: string,
  limit: number,
  outstanding: number,
  proposed: number,
  format: (n: number) => string,
): string {
  return (
    `${who} is over its credit limit of ${format(limit)}. ` +
    `${format(outstanding)} is already outstanding and this document adds ` +
    `${format(proposed)}, taking it to ${format(cents(outstanding + proposed))}. ` +
    `Raise the limit, settle something first, or save it with the limit overridden.`
  );
}