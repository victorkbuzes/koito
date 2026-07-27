import { NextResponse } from "next/server";
import { processCheckIn } from "@/services/checkin.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { delegateId, code, tableId, seatNumber } = body;

    if (!delegateId && !code) {
      return NextResponse.json({ error: "Delegate ID or Code is required" }, { status: 400 });
    }

    const result = await processCheckIn({ delegateId, code, tableId, seatNumber });
    return NextResponse.json(result);
  } catch (error: any) {
    const msg: string = error.message || "";
    if (msg === "INVALID_GUEST") {
      return NextResponse.json({ error: "Delegate not found" }, { status: 404 });
    }
    if (msg.startsWith("TABLE_FULL:")) {
      const parts = msg.split(":");
      const tableName = parts[1];
      const maxCap = parts[2];
      return NextResponse.json(
        { error: `Table "${tableName}" is already at full capacity (${maxCap} max).` },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
