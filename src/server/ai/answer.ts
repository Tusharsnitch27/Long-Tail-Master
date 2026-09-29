import "server-only";
import { z } from "zod";

/** Structured final response. Views reference tool results by id; the server fills in the data. */
const Fmt = z.enum(["inr", "num", "pct", "delta", "dec", "text", "date"]).nullable();

export const ViewSchema = z.strictObject({
  type: z.enum(["kpi", "table", "bar", "line", "area", "comparison", "heatmap"]),
  title: z.string(),
  result_id: z.string().describe("id of the tool result that holds the data, e.g. r3"),
  x: z.string().nullable().describe("category / date field for bar, line, area; column field for heatmap"),
  y: z.array(z.string()).nullable().describe("numeric field(s) to plot; for heatmap one value field"),
  group: z.string().nullable().describe("heatmap row field, or a field that splits line series"),
  columns: z.array(z.string()).nullable().describe("table columns (fields in the result rows); null = the result's default columns"),
  sort_by: z.string().nullable(),
  sort_dir: z.enum(["asc", "desc"]).nullable(),
  limit: z.number().int().min(1).max(200).nullable(),
  kpis: z.array(z.strictObject({
    label: z.string(),
    field: z.string().describe("dotted path in the result, e.g. summary.revenue, summary.month.projected, coverage.feed_stores; or a row field when row_key is set"),
    row_key: z.string().nullable().describe("pick the data row whose key equals this"),
    format: Fmt,
  })).nullable().describe("for type=kpi (and comparison: pairs of current/previous fields)"),
});

export const AnswerSchema = z.strictObject({
  answer: z.string().describe("Direct answer first, then key evidence. Markdown: **bold**, '- ' bullets, short paragraphs."),
  metrics: z.array(z.strictObject({ label: z.string(), value: z.string(), basis: z.enum(["fact", "calculated"]), result_id: z.string().nullable() })),
  insights: z.array(z.strictObject({ text: z.string(), kind: z.enum(["fact", "calculated", "interpretation"]) })),
  actions: z.array(z.strictObject({ text: z.string(), priority: z.enum(["high", "medium", "low"]), evidence: z.string() })),
  visualizations: z.array(ViewSchema),
  limitations: z.array(z.string()),
  follow_up_questions: z.array(z.string()),
  context: z.strictObject({
    products: z.array(z.string()), skus: z.array(z.string()), locations: z.array(z.string()), categories: z.array(z.string()), period: z.string().nullable(),
  }),
});
export type Answer = z.infer<typeof AnswerSchema>;
export type View = z.infer<typeof ViewSchema>;

export const SUBMIT_TOOL = {
  name: "submit_answer",
  description: "Deliver the final answer to the user. Call exactly once, as the last step of every turn, after gathering data. All user-facing content goes here.",
  schema: AnswerSchema,
};
