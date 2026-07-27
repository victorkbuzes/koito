import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export interface DatabaseHealth {
  connected: boolean;
}

export class HealthRepository {
  async checkDatabase(): Promise<DatabaseHealth> {
    try {
      await prisma.$queryRaw`SELECT 1`;

      return {
        connected: true,
      };
    } catch (error) {
      logger.error(
        { error },
        "Database connectivity check failed.",
      );

      return {
        connected: false,
      };
    }
  }
}

export const healthRepository = new HealthRepository();