import { NextRequest, NextResponse } from "next/server";
import { saveOpenDartAccountMapping } from "@/lib/marketData";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      statementDiv?: string;
      accountId?: string;
      accountName?: string;
      lineKey?: string;
    };
    const result = await saveOpenDartAccountMapping({
      statementDiv: body.statementDiv || "",
      accountId: body.accountId || "",
      accountName: body.accountName || "",
      lineKey: body.lineKey || ""
    });
    return NextResponse.json({ ok: true, mappingCount: result.mappings.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mapping save failed." }, { status: 400 });
  }
}
