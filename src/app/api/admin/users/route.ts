import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { dbConfigured, q } from "@/server/db";
import { hashPassword, PASSWORD_RULE, validPassword, validUsername } from "@/server/passwords";
import { invalidate } from "@/lib/cache";
import { apiError } from "@/server/api";

const Username = z.string().trim().toLowerCase().refine(validUsername, "Username: 3–80 characters — letters, digits, . _ - @ + (an email address works). No spaces.");
const Password = z.string().refine(validPassword, `password must be ${PASSWORD_RULE}`);
const Role = z.enum(["viewer", "admin"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), username: Username, name: z.string().trim().max(80).nullish(), password: Password, role: Role }),
  z.object({ action: z.literal("update"), username: Username, name: z.string().trim().max(80).nullish(), role: Role.nullish(), active: z.boolean().nullish() }),
  z.object({ action: z.literal("reset_password"), username: Username, password: Password }),
  z.object({ action: z.literal("delete"), username: Username }),
]);

export async function POST(req: Request) {
  try {
    const actor = await requireUser("admin");
    if (!dbConfigured()) return NextResponse.json({ error: "DATABASE_URL is not configured — users can't be managed." }, { status: 503 });
    const p = Body.safeParse(await req.json());
    if (!p.success) return NextResponse.json({ error: p.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    const b = p.data;
    const self = b.username === actor.username;
    const otherActiveAdmins = async () => (await q<{ n: number }>("select count(*)::int n from app_users where role = 'admin' and active and username <> $1", [b.username]))[0].n;
    const audit = (action: string, detail: unknown) => q("insert into audit_log(actor, action, entity, entity_id, detail) values ($1,$2,'user',$3,$4)", [actor.username, action, b.username, JSON.stringify(detail)]);

    if (b.action === "create") {
      const exists = await q("select 1 from app_users where username = $1", [b.username]);
      if (exists.length) return NextResponse.json({ error: `Username "${b.username}" already exists.` }, { status: 409 });
      await q("insert into app_users(username, name, role, active, password_hash, created_by, password_changed_at) values ($1,$2,$3,true,$4,$5,now())",
        [b.username, b.name || null, b.role, await hashPassword(b.password), actor.username]);
      await audit("create", { role: b.role });
    } else if (b.action === "update") {
      if (self && (b.role === "viewer" || b.active === false)) return NextResponse.json({ error: "You can't remove your own admin access." }, { status: 400 });
      if ((b.role === "viewer" || b.active === false) && (await otherActiveAdmins()) === 0) return NextResponse.json({ error: "At least one active admin is required." }, { status: 400 });
      const r = await q("update app_users set name = coalesce($2, name), role = coalesce($3, role), active = coalesce($4, active) where username = $1 returning username",
        [b.username, b.name ?? null, b.role ?? null, b.active ?? null]);
      if (!r.length) return NextResponse.json({ error: "User not found" }, { status: 404 });
      await audit("update", { role: b.role, active: b.active, name: b.name });
    } else if (b.action === "reset_password") {
      const r = await q("update app_users set password_hash = $2, password_changed_at = now() where username = $1 returning username", [b.username, await hashPassword(b.password)]);
      if (!r.length) return NextResponse.json({ error: "User not found" }, { status: 404 });
      await audit("reset_password", {});
    } else {
      if (self) return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
      if ((await otherActiveAdmins()) === 0) return NextResponse.json({ error: "At least one active admin is required." }, { status: 400 });
      await q("delete from app_users where username = $1", [b.username]);
      await audit("delete", {});
    }
    invalidate(`user:${b.username}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
