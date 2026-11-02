// The registrar response must describe the exact requested purchase, not merely
// a matching price. Recheck immediately before the one-way submit boundary.
export function matchesRegistrationQuote(quote,domain,action,years) {
  return quote?.hostname===domain && quote.action===action && quote.years===years &&
    quote.available===true && quote.premium===false && quote.currency==='USD' &&
    Number.isSafeInteger(quote.registrar_cents) && quote.registrar_cents>0;
}
