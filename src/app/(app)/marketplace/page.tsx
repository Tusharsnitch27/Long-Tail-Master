import { pageContext, type SP } from "@/server/context";
import { ChannelDetail } from "@/components/ChannelDetail";

export const metadata = { title: "Marketplace Overview" };

export default async function MarketplaceOverview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  return <ChannelDetail ctx={ctx} channel="marketplace" />;
}
