/**
 * Money masking for roles without revenue access. Server components format through `inr`, which consults a
 * per-request flag (registered by server/context with React cache); client components read the access context.
 */
let serverFlag: (() => { on: boolean }) | null = null;
export const registerMoneyMask = (f: () => { on: boolean }) => { serverFlag = f; };
export const moneyMasked = () => (serverFlag ? serverFlag().on : false);
export const MASK = "—";

/** Replace ₹ amounts inside pre-formatted text (action titles, impacts, to-dos) with a dash. */
export const scrubMoney = (t: string) => t.replace(/[≈~]?\s*₹\s?[\d.,]+\s?(Cr|L|K)?(\/(day|month))?/g, "₹ —");
