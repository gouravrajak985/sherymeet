import { NextRequest, NextResponse } from "next/server";
import { config as appConfig } from "@/server/utils/config";

/**
 * Centralized gate for the browser-facing /api/server/* routes (Next.js 16
 * proxy, formerly middleware). Standard layered defense:
 *
 *  1. Fetch metadata (Sec-Fetch-Site) — sent by every modern browser and not
 *     settable from JavaScript, so a request coming from another website can
 *     never look same-origin. This is the OWASP-recommended CSRF layer.
 *  2. Origin/Referer allowlist — must match NEXT_PUBLIC_API_URL when present;
 *     requests with no browser provenance headers at all are rejected.
 *
 * Headers can always be forged by non-browser clients, so these layers only
 * filter traffic. Real authentication is the signed LiveKit room token that
 * every /api/server/* handler verifies server-side.
 */

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: `Forbidden: ${reason}` }, { status: 403 });
}

export function proxy(request: NextRequest) {
  // In development, skip all origin checks to allow egress testing from external domains
  if (appConfig.NODE_ENV === "development") {
    return NextResponse.next();
  }

  // Layer 1: fetch metadata. Browsers always send this; anything other than
  // a same-origin call is rejected outright (unless it's from the recording origin).
  const secFetchSite = request.headers.get("sec-fetch-site");

  // Layer 2: Origin/Referer allowlist.
  const allowedOrigin = appConfig.NEXT_PUBLIC_API_URL;
  if (!allowedOrigin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(allowedOrigin).origin;
  } catch {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Build allowed origins list (main app + recording URL if configured)
  const allowedOrigins = [expectedOrigin];
  if (appConfig.RECORDING_BASE_URL) {
    try {
      const recordingOrigin = new URL(appConfig.RECORDING_BASE_URL).origin;
      if (!allowedOrigins.includes(recordingOrigin)) {
        allowedOrigins.push(recordingOrigin);
      }
    } catch {
      // Invalid RECORDING_BASE_URL, ignore
    }
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Check if request is from an allowed origin
  const requestOrigin = origin || (referer ? new URL(referer).origin : null);
  const isAllowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin);

  // For cross-origin requests, only allow if from recording origin
  if (secFetchSite && secFetchSite !== "same-origin" && !isAllowedOrigin) {
    return forbidden("cross-origin requests are not allowed");
  }

  if (origin) {
    try {
      if (!allowedOrigins.includes(new URL(origin).origin)) {
        return forbidden("origin mismatch");
      }
    } catch {
      return forbidden("invalid origin header");
    }
  } else if (referer) {
    try {
      if (!allowedOrigins.includes(new URL(referer).origin)) {
        return forbidden("referer mismatch");
      }
    } catch {
      return forbidden("invalid referer header");
    }
  } else if (!secFetchSite) {
    // No fetch metadata and no provenance headers: not a browser call from
    // our app. Same-origin browser requests always carry at least one of
    // these (Referrer-Policy is same-origin, so Referer is sent).
    return forbidden("missing request provenance headers");
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/server/:path*",
};
