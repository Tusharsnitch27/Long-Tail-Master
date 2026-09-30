/**
 * Product search + facet helpers (pure; shared by DataTable and the Product Master grid).
 *
 * Search text is built on the server (name + SKU + L1 + L2 + collection + metafield attributes + category words) and
 * normalised here. A query matches when EVERY word matches the start of some word in the text (multi-word AND), with
 * light plural handling: "black shoes" → "black" AND ("shoes" | "shoe"). Words containing a digit (SKU fragments)
 * match anywhere.
 */
export const normText = (s: string) => " " + s.toLowerCase().replace(/[^a-z0-9-]+/g, " ").trim() + " ";

function variants(t: string) {
  const out = [t];
  if (t.length > 3 && t.endsWith("s")) out.push(t.slice(0, -1));
  if (t.endsWith("es") && t.length - 2 >= 4) out.push(t.slice(0, -2));
  if (t.endsWith("ies") && t.length > 4) out.push(t.slice(0, -3) + "y");
  return out;
}

export function queryTerms(q: string) {
  return q.toLowerCase().replace(/[^a-z0-9-]+/g, " ").trim().split(" ").filter(Boolean);
}

/** `text` should already be normalised with normText (leading/trailing space). */
export function matchTerms(text: string, terms: string[]) {
  return terms.every((t) => (/\d/.test(t) ? text.includes(t) : variants(t).some((v) => text.includes(" " + v))));
}

export function matchQuery(text: string, q: string) {
  const terms = queryTerms(q);
  return !terms.length || matchTerms(normText(text), terms);
}

export interface FacetDef { key: string; label: string }
type Row = Record<string, unknown>;

/** Distinct values (with counts) for each facet, computed over rows that pass every OTHER active facet. */
export function facetOptions(rows: Row[], facets: FacetDef[], sel: Record<string, string>) {
  const out: Record<string, { v: string; n: number }[]> = {};
  for (const f of facets) {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!facets.every((o) => o.key === f.key || !sel[o.key] || String(r[o.key] ?? "") === sel[o.key])) continue;
      const v = r[f.key];
      if (v == null || v === "") continue;
      m.set(String(v), (m.get(String(v)) ?? 0) + 1);
    }
    out[f.key] = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => ({ v, n }));
  }
  return out;
}

export function passFacets(r: Row, facets: FacetDef[], sel: Record<string, string>) {
  return facets.every((f) => !sel[f.key] || String(r[f.key] ?? "") === sel[f.key]);
}
