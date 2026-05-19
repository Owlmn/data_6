import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const PYTHON_URL = process.env.NEXT_PUBLIC_PYTHON_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const message = typeof body.message === "string" ? body.message : "";
    if (message.length > 5000) {
      return NextResponse.json({ error: "Message too long (max 5000 chars)" }, { status: 400 });
    }

    const res = await fetch(`${PYTHON_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: (data as Record<string, string>).detail || (data as Record<string, string>).error || "Backend error" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("Proxy error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal proxy error" },
      { status: 500 }
    );
  }
}
