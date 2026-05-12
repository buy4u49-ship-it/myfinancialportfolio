import { NextRequest, NextResponse } from "next/server";
import { readSessionUsername } from "@/lib/auth";
import { inferCurrency, normalizeSymbol } from "@/lib/symbols";
import type { PortfolioImportPosition, PortfolioImportPreviewResponse } from "@/lib/types";
import { getUserRecord } from "@/lib/userStore";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cleanJsonText(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  return firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
}

function responseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content) ? ((item as Record<string, unknown>).content as unknown[]) : [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const raw = part as Record<string, unknown>;
        if (typeof raw.text === "string") {
          chunks.push(raw.text);
        }
      }
    }
  }
  return chunks.join("\n");
}

function normalizePosition(input: unknown): PortfolioImportPosition | null {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const currency = String(raw.currency || inferCurrency(String(raw.symbol || ""))).toUpperCase();
  const symbol = normalizeSymbol(String(raw.symbol || ""), currency);
  const quantity = numberOrNull(raw.quantity);
  const avgCost = numberOrNull(raw.avgCost);
  if (!symbol || quantity === null || quantity <= 0 || avgCost === null || avgCost < 0) {
    return null;
  }
  return {
    symbol,
    name: raw.name ? String(raw.name) : "",
    quantity,
    avgCost,
    currency,
    marketValue: numberOrNull(raw.marketValue),
    confidence: numberOrNull(raw.confidence),
    note: raw.note ? String(raw.note) : ""
  };
}

function normalizePreview(input: unknown): PortfolioImportPreviewResponse {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const positions = Array.isArray(raw.positions) ? raw.positions.map(normalizePosition).filter((item): item is PortfolioImportPosition => Boolean(item)) : [];
  const cashBalance = numberOrNull(raw.cashBalance);
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.map((item) => String(item)).filter(Boolean) : [];
  return {
    brokerName: raw.brokerName ? String(raw.brokerName) : "",
    accountLabel: raw.accountLabel ? String(raw.accountLabel) : "",
    cashBalance,
    cashCurrency: String(raw.cashCurrency || "KRW").toUpperCase(),
    positions,
    warnings
  };
}

async function analyzeWithOpenAI(file: File) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for screenshot analysis.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Please upload an image under 8 MB.");
  }
  const mimeType = file.type || "image/png";
  if (!mimeType.startsWith("image/")) {
    throw new Error("Please upload an image file.");
  }
  const imageUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const model = process.env.OPENAI_PORTFOLIO_IMPORT_MODEL || "gpt-4.1-mini";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract portfolio holdings from this brokerage or crypto exchange screenshot. Return only JSON with keys brokerName, accountLabel, cashBalance, cashCurrency, positions, warnings. positions must contain objects with symbol, name, quantity, avgCost, currency, marketValue, confidence, note. For Korean crypto exchange KRW pairs, output symbols like BTC-KRW, ETH-KRW, SOL-KRW, XRP-KRW. For US stocks, output ticker symbols. For Korean stocks, output 6-digit code with .KS or .KQ only if visible; otherwise put the visible name in name and add a warning. Use avgCost from average purchase price, quantity from held quantity, and currency from the screen. Ignore profit/loss rows as positions."
            },
            {
              type: "input_image",
              image_url: imageUrl
            }
          ]
        }
      ]
    })
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object" && "message" in payload.error ? String((payload.error as Record<string, unknown>).message) : "Screenshot analysis failed.";
    throw new Error(error);
  }
  const text = responseText(payload);
  if (!text) {
    throw new Error("Screenshot analysis returned no readable result.");
  }
  return normalizePreview(JSON.parse(cleanJsonText(text)));
}

export async function POST(request: NextRequest) {
  try {
    const username = readSessionUsername(request);
    if (!username || !(await getUserRecord(username))) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }
    const preview = await analyzeWithOpenAI(file);
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Screenshot import failed." }, { status: 400 });
  }
}
