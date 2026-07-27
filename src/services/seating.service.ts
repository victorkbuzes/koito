import { prisma } from "@/lib/prisma";
import { getDefaultEvent, formatGuest } from "@/lib/utils";
import { createAuditLog } from "./audit.service";

export interface CreateTableInput {
  name: string;
  capacity: number;
  zone?: string | null;
  description?: string | null;
}

/**
 * Service function to retrieve all dining tables and assigned guests.
 */
export async function getTablesWithSeating() {
  const event = await getDefaultEvent();

  const diningTables = await prisma.diningTable.findMany({
    where: { eventId: event.id },
    include: {
      seats: {
        orderBy: { seatNumber: "asc" },
        include: {
          seatingAssignment: {
            include: {
              guest: {
                include: {
                  qrCode: true,
                  checkIn: true,
                  seatingAssignment: {
                    include: {
                      seat: {
                        include: {
                          diningTable: true,
                        },
                      },
                    },
                  },
                  guestRoles: {
                    include: {
                      role: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return diningTables.map((t: any) => {
    const assignedGuests = t.seats
      .filter((s: any) => s.seatingAssignment?.guest)
      .map((s: any) => formatGuest(s.seatingAssignment!.guest));

    return {
      id: t.id,
      name: t.name,
      zone: t.zone || null,
      capacity: t.seats.length,
      description: t.description || null,
      delegates: assignedGuests,
    };
  });
}

/**
 * Service function to atomically create a Dining Table and its Seats in a single transaction.
 */
export async function createTableWithSeats(input: CreateTableInput) {
  const { name, capacity, zone, description } = input;
  const event = await getDefaultEvent();

  return await prisma.$transaction(async (tx) => {
    // 1. Create DiningTable
    const createdTable = await tx.diningTable.create({
      data: {
        eventId: event.id,
        name,
        zone: zone || null,
        description: description || null,
      },
    });

    // 2. Generate seat records
    const seatData = Array.from({ length: capacity }, (_, i) => ({
      diningTableId: createdTable.id,
      seatNumber: i + 1,
    }));

    await tx.seat.createMany({
      data: seatData,
    });

    // 3. Log Audit
    await createAuditLog(
      {
        actorType: "ADMIN",
        actorId: "system",
        action: "CREATE",
        entityType: "DINING_TABLE",
        entityId: createdTable.id,
        metadata: { tableName: name, capacity },
      },
      tx
    );

    // 4. Return created table structure
    const fullTable = await tx.diningTable.findUnique({
      where: { id: createdTable.id },
      include: { seats: true },
    });

    return {
      id: fullTable?.id,
      name: fullTable?.name,
      capacity: fullTable?.seats.length || capacity,
      delegates: [],
    };
  });
}
