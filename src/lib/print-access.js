// Who may open the printable leave form.
//
// This lives on its own because the router guard is in the first bundle: importing
// the check from leave-print.js pulled the whole print formatter — and its
// Thai-date formatter — into the entry chunk for one role comparison.
// leave-print.js re-exports both values, so its own callers are unchanged.

export const PRINT_ALLOWED_ROLE = 'hr'

/** Only HR may open the printable form. */
export function canPrintLeave(role) {
  return role === PRINT_ALLOWED_ROLE
}
