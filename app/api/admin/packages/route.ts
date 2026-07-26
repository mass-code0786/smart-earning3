import { NextRequest,NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { adminPackageReport } from "@/lib/server/package-service";
export async function GET(request:NextRequest){try{await requireAdmin();return NextResponse.json(await adminPackageReport(request.nextUrl.searchParams.get("q")||undefined))}catch(error){return apiError(error)}}
