import { NextResponse } from "next/server";

import { env } from "@/config/env";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export async function GET() {
  logger.info("Running infrastructure verification.");

  try {
    const result = await prisma.$queryRaw<
      Array<{ current_time: Date }>
    >`SELECT CURRENT_TIMESTAMP AS current_time`;

    return NextResponse.json({
      status: "ok",
      environment: env.NODE_ENV,
      database: "connected",
      serverTime: result[0].current_time.toISOString(),
    });
  } catch (error) {
    logger.error({ error }, "Database verification failed.");

    return NextResponse.json(
      {
        status: "error",
        environment: env.NODE_ENV,
        database: "disconnected",
        message: "Unable to connect to PostgreSQL.",
      },
      {
        status: 503,
      },
    );
  }
}