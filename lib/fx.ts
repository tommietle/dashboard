import { cached } from './cache';

// ECB-backed wisselkoersen via frankfurter.app (gratis, geen API key nodig).
// We cachen 12 uur — ECB publiceert toch maar 1x per dag.

type Rates = Record<string, number>;

async function fetchEurRates(): Promise<Rates> {
  return cached<Rates>('fx:eur-rates', 12 * 3600, async () => {
    try {
      const res = await fetch('https://api.frankfurter.app/latest?base=EUR', { cache: 'no-store' });
      if (!res.ok) throw new Error(`FX ${res.status}`);
      const data = await res.json();
      // data.rates: { USD: 1.08, CAD: 1.47, ... }  → bedrag in EUR = bedrag_in_X / rates[X]
      return data.rates as Rates;
    } catch {
      // Veilige fallback (ongeveer ECB ~mei 2026) — beter dan kapot dashboard.
      return { USD: 1.08, CAD: 1.47, AUD: 1.74, GBP: 0.86, CHF: 0.94, EUR: 1 };
    }
  });
}

// Converteert een bedrag in `from` currency naar EUR.
export async function toEur(amount: number, from: string): Promise<number> {
  if (!amount) return 0;
  if (from === 'EUR') return amount;
  const rates = await fetchEurRates();
  const r = rates[from];
  if (!r) return amount; // onbekend → laat staan
  return amount / r;
}

// Bouwt een lookup {USD: factor, CAD: factor, EUR: 1} zodat callers
// in een tight loop kunnen converteren zonder steeds awaits.
export async function getEurConverter(): Promise<(amount: number, from: string) => number> {
  const rates = await fetchEurRates();
  return (amount: number, from: string): number => {
    if (!amount) return 0;
    if (from === 'EUR') return amount;
    const r = rates[from];
    if (!r) return amount;
    return amount / r;
  };
}
