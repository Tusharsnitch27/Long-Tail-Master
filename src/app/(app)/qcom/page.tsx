import { pageContext, type SP } from "@/server/context";
import { ChannelDetail } from "@/components/ChannelDetail";

export const metadata = { title: "Qcom" };

/** Quick commerce: orders fulfilled from stores (POS doc prefix QCOM), sold online on Shopify. */
export default async function Qcom({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await pageContext(searchParams);
  return <ChannelDetail ctx={ctx} channel="online" forcedMp="QCOM" />;
}
