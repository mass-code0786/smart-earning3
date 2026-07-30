import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { blockchainIndexerHealth } from "@/lib/server/blockchain-indexer";
import { apiError } from "@/lib/server/http";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await blockchainIndexerHealth());
  } catch (error) {
    return apiError(error);
  }
}
