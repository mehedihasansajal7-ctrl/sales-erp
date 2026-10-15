import { NextResponse } from "next/server";
import { signOutAction } from "@/actions/auth";

/**
 * Sign-out endpoint. The forms POST here (progressive enhancement) so sign-out
 * works even if JavaScript fails to load.
 */
export async function POST(request: Request) {
  await signOutAction();
  return NextResponse.redirect(new URL("/login", request.url));
}
