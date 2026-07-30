import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { apiError } from "@/lib/server/http";
import { getRegistrationSchemaReadiness } from "@/lib/server/registration-schema-readiness";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getRegistrationSchemaReadiness());
  } catch (error) {
    return apiError(error);
  }
}
