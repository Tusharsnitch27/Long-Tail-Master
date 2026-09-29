import { NextResponse } from "next/server";
import Papa from "papaparse";
import { requireUser } from "@/server/auth";
import { dbConfigured } from "@/server/db";
import { applyOverrides } from "@/server/data/targets";
import { getStoreMap } from "@/server/data/stores";
import { validateOverrides } from "@/server/targetInput";
import { apiError } from "@/server/api";

/**
 * CSV columns: category, branch_code (or store_name), grain (month|week|day), period_start (YYYY-MM-DD), target, note
 * Empty target clears the override. POST without ?commit=1 is a dry run.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser("editor");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
    const commit = new URL(req.url).searchParams.get("commit") === "1";
    const text = await req.text();
    if (text.length > 5_000_000) return NextResponse.json({ error: "file too large (5 MB max)" }, { status: 413 });
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
    if (parsed.errors.length) return NextResponse.json({ error: "CSV parse error", errors: parsed.errors.slice(0, 20).map((e) => ({ row: (e.row ?? 0) + 1, message: e.message })) }, { status: 422 });
    const raw = parsed.data.map((r) => ({
      category: (r.category ?? "").trim().toLowerCase(),
      branch_code: (r.branch_code || r.store_name || r.store || "").trim(),
      grain: (r.grain || "month").trim().toLowerCase(),
      period_start: (r.period_start || r.month || r.date || "").trim().replace(/^(\d{4}-\d{2})$/, "$1-01"),
      target: r.target == null || r.target.trim() === "" ? null : Number(r.target.replace(/[₹,\s]/g, "")),
      note: r.note?.trim() || null,
    }));
    const { byCode, byName } = await getStoreMap();
    const { ok, errors } = validateOverrides(raw, byCode, byName);
    if (!commit || errors.length) {
      return NextResponse.json({ dryRun: true, valid: ok.length, errors, total: ok.reduce((a, r) => a + (r.target ?? 0), 0), clears: ok.filter((r) => r.target == null).length }, { status: errors.length ? 422 : 200 });
    }
    const res = await applyOverrides(ok, user.email, "upload");
    return NextResponse.json({ committed: true, ...res });
  } catch (e) {
    return apiError(e);
  }
}
