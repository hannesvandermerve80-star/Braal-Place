export const toRand = (cents) => (cents == null ? null : Math.round(cents) / 100);
export const toCents = (rand) => Math.round(Number(rand) * 100);
/** VAT included in a VAT-inclusive amount (15%). */
export const vatPortion = (cents, rate = 0.15) => Math.round(cents - cents / (1 + rate));
