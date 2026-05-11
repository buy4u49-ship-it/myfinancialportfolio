import FinancialApp from "@/components/FinancialApp";

export default async function SymbolDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <FinancialApp initialPage="symbol" initialSymbol={decodeURIComponent(symbol || "AAPL").toUpperCase()} />;
}
