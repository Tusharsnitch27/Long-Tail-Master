import { getUser } from "@/server/auth";
import { ROLE_LABEL } from "@/lib/access";

export const metadata = { title: "No access" };

export default async function NoAccess() {
  const user = await getUser().catch(() => null);
  return (
    <div className="card mx-auto mt-10 max-w-lg rounded-[18px] px-6 py-10 text-center">
      <div className="font-serif text-[20px]">Not available for your access</div>
      <p className="mt-2 text-[12.5px] text-zinc-500">Your role{user ? ` (${ROLE_LABEL[user.role]})` : ""} doesn’t include that page. Ask an admin if you need it.</p>
    </div>
  );
}
