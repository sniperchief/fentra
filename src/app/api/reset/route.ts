import { NextResponse } from "next/server";
import { resetSession } from "@/server/session";

export async function POST() {
  resetSession();
  return NextResponse.json({ ok: true });
}
