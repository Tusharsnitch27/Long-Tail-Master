import { pageContext, type SP } from "@/server/context";
import { ChannelDetail } from "@/components/ChannelDetail";

export const metadata = { title: "Online Overview" };

export default async function OnlineOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  return <ChannelDetail ctx={ctx} channel="online" />;
}
