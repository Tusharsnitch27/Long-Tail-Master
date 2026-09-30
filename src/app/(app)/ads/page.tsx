import { BarChart3, Target, Wallet, TrendingUp, Layers, Megaphone } from "lucide-react";
import { PageHeader, Section, DataPrompt } from "@/components/ui";
import { WipPill } from "@/components/wip/ui";

export const metadata = { title: "Ads Spend & Insight" };

const BLOCKS = [
  { icon: Wallet, t: "Spend by channel & category", d: "Meta, Google, marketplace ads (Myntra / Ajio / Flipkart / Amazon sponsored) split by long-tail category, daily and month-to-date vs budget." },
  { icon: Target, t: "ROAS & CAC", d: "Attributed revenue ÷ spend by campaign, category and channel; cost per new customer for Online; ACoS for marketplace campaigns." },
  { icon: TrendingUp, t: "Spend vs sales lift", d: "Daily spend against category revenue with a pre / post baseline — does an extra ₹1 L of spend move Stores and Online, or only the attributed channel?" },
  { icon: Layers, t: "SKU-level efficiency", d: "Top advertised SKUs: spend, clicks, conversion, ROAS, and whether they have the stock (DOI) to support the spend." },
  { icon: BarChart3, t: "Budget pacing & mix", d: "Month budget vs spend-to-date, with the share of spend per category compared with its share of revenue and plan." },
  { icon: Megaphone, t: "Suggested actions", d: "Pause spend on SKUs with < 14 days cover, scale campaigns with ROAS above target, shift budget to categories behind plan with healthy stock." },
];

export default function AdsPage() {
  return (
    <>
      <PageHeader title="Ads Spend & Insight" right={<WipPill label="Planned" />} subtitle="Planned for a future release — marketing spend joined to long-tail sales, stock and plan" />
      <div className="mb-4">
        <DataPrompt title="Share the ads spend source to switch this on">
          We need a table with one row per day × platform × campaign (ideally ad set / SKU): date, platform, campaign, category or SKU, spend, impressions, clicks, attributed orders and revenue.
          If it already lands in Snowflake (e.g. a MAPLEMONK Meta / Google / marketplace ads table), send the table name to the tool owner; otherwise a daily CSV export works as a first step.
        </DataPrompt>
      </div>
      <Section title="What this page will contain">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BLOCKS.map(({ icon: I, t, d }) => (
            <div key={t} className="rounded-lg border border-line bg-canvas/50 p-3">
              <div className="mb-1 flex items-center gap-2 text-[12.5px] font-semibold text-zinc-800"><span className="flex size-6 items-center justify-center rounded-md bg-brand-50 text-brand-700"><I className="size-3.5" /></span>{t}</div>
              <p className="text-[12px] text-zinc-500">{d}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section className="mt-3" title="Data needed">
        <ul className="grid gap-1.5 text-[12px] text-zinc-600 md:grid-cols-2">
          <li><b className="text-zinc-800">Ads spend</b> — daily spend by platform × campaign (Meta, Google, marketplace sponsored ads).</li>
          <li><b className="text-zinc-800">Campaign → category / SKU mapping</b> — so spend can be tied to long-tail categories and products.</li>
          <li><b className="text-zinc-800">Attribution</b> — platform-attributed orders / revenue (or UTM-tagged Shopify orders).</li>
          <li><b className="text-zinc-800">Budgets</b> — monthly budget per platform × category (can be entered in the Control Centre).</li>
          <li><b className="text-zinc-800">Already available</b> — sales by channel (Stores DSR, Unicommerce Online / Marketplace), SKU stock and DOI, month targets.</li>
          <li><b className="text-zinc-800">Nice to have</b> — new vs returning customer flag for CAC; marketplace ad reports (ACoS) per SKU.</li>
        </ul>
      </Section>
    </>
  );
}
