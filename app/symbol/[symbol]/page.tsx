import FinancialAppRoute from "@/components/FinancialAppRoute";

export default async function SymbolDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <FinancialAppRoute page="symbol" symbol={decodeURIComponent(symbol || "AAPL").toUpperCase()} />;
}
