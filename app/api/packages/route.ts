import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getPackageDashboard } from "@/lib/server/package-service";
export async function GET(){try{const session=await requireSession();return NextResponse.json(await getPackageDashboard(session.wallet))}catch(error){return apiError(error)}}
