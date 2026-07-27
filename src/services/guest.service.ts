import { prisma } from "@/lib/prisma";
import { generateUnique4DigitCode, normalizePhone, getDefaultEvent, formatGuest } from "@/lib/utils";
import { createAuditLog } from "./audit.service";
import type { Prisma } from "@prisma/client";

export interface GetDelegatesParams {
  search?: string;
  status?: string;
  pageParam?: string;
  limitParam?: string;
}

export interface CreateGuestParams {
  name: string;
  phone?: string | null;
  role?: string;
  tableId?: string;
  notes?: string;
  code?: string;
}

const includeRelations = {
  qrCode: true,
  checkIn: true,
  rsvp: true,
  cluster: true,
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
};

/**
 * Service function to retrieve formatted delegate lists and pagination stats.
 */
export async function getDelegates(params: GetDelegatesParams) {
  const { search = "", status = "", pageParam = "1", limitParam = "10" } = params;

  const where: any = {};
  const trimmedSearch = search.trim();
  const isNumeric = /^\d+$/.test(trimmedSearch);

  if (trimmedSearch) {
    if (isNumeric) {
      where.OR = [
        { pin: { startsWith: trimmedSearch, mode: "insensitive" } },
        { pinFingerprint: { startsWith: trimmedSearch, mode: "insensitive" } },
        { qrCode: { code: { startsWith: trimmedSearch, mode: "insensitive" } } },
        { phone: { startsWith: trimmedSearch } },
        { fullName: { startsWith: trimmedSearch, mode: "insensitive" } },
      ];
    } else {
      where.OR = [
        { fullName: { contains: trimmedSearch, mode: "insensitive" } },
        { pin: { startsWith: trimmedSearch, mode: "insensitive" } },
        { pinFingerprint: { startsWith: trimmedSearch, mode: "insensitive" } },
        { qrCode: { code: { startsWith: trimmedSearch, mode: "insensitive" } } },
        { phone: { startsWith: trimmedSearch } },
        { organization: { contains: trimmedSearch, mode: "insensitive" } },
      ];
    }
  }

  if (status && status !== "ALL") {
    if (status === "CHECKED_IN") {
      where.checkIn = { isNot: null };
    } else if (status === "INVITED") {
      where.checkIn = null;
    }
  }

  const isAll = limitParam.toUpperCase() === "ALL";
  const page = Math.max(1, parseInt(pageParam) || 1);
  const limit = isAll ? 0 : Math.max(1, parseInt(limitParam) || 10);

  const [
    total,
    guests,
    totalGlobal,
    checkedInGlobal,
    invitedGlobal,
    assignedSeatsGlobal,
    rsvpsGlobal,
    attendingRsvpsGlobal,
  ] = await Promise.all([
    prisma.guest.count({ where }),
    prisma.guest.findMany({
      where,
      include: includeRelations,
      orderBy: { createdAt: "desc" },
      ...(isAll ? {} : { skip: (page - 1) * limit, take: limit }),
    }),
    prisma.guest.count(),
    prisma.guest.count({ where: { checkIn: { isNot: null } } }),
    prisma.guest.count({ where: { checkIn: null } }),
    prisma.guest.count({ where: { seatingAssignment: { isNot: null } } }),
    prisma.rSVP.count(),
    prisma.rSVP.count({ where: { status: "ATTENDING" } }),
  ]);

  const formattedDelegates = guests.map(formatGuest);

  if (trimmedSearch) {
    formattedDelegates.sort((a: any, b: any) => {
      const codeA = (a.code || "").toLowerCase();
      const codeB = (b.code || "").toLowerCase();
      const startsA = codeA.startsWith(trimmedSearch.toLowerCase());
      const startsB = codeB.startsWith(trimmedSearch.toLowerCase());
      if (startsA && !startsB) return -1;
      if (!startsA && startsB) return 1;
      return codeA.localeCompare(codeB, undefined, { numeric: true });
    });
  }

  const totalPages = isAll ? 1 : Math.ceil(total / (limit || 1));

  return {
    delegates: formattedDelegates,
    total,
    page,
    pageSize: isAll ? total : limit,
    totalPages,
    stats: {
      total: totalGlobal,
      checkedIn: checkedInGlobal,
      invited: invitedGlobal,
      cancelled: 0,
      assignedSeats: assignedSeatsGlobal,
      rsvps: rsvpsGlobal,
      attendingRsvps: attendingRsvpsGlobal,
    },
  };
}

/**
 * Service function to create a Guest with PIN, QRCode, Seating, GuestRole, and AuditLog.
 */
export async function createGuest(params: CreateGuestParams) {
  const { name, phone: rawPhone, role, tableId, notes, code: inputCode } = params;

  if (!name) {
    throw new Error("NAME_REQUIRED");
  }

  const event = await getDefaultEvent();
  const phone = normalizePhone(rawPhone);

  if (phone) {
    const existing = await prisma.guest.findFirst({
      where: { phone, eventId: event.id },
      include: { qrCode: true },
    });
    if (existing) {
      throw new Error(`DUPLICATE_PHONE:${phone}:${existing.fullName}:${existing.qrCode?.code || "N/A"}`);
    }
  }

  let targetSeatId: string | null = null;

  if (tableId === "auto") {
    const allTables = await prisma.diningTable.findMany({
      where: { eventId: event.id },
      include: { seats: { include: { seatingAssignment: true } } },
      orderBy: { name: "asc" },
    });

    for (const t of allTables) {
      const openSeat = t.seats.find((s: any) => !s.seatingAssignment);
      if (openSeat) {
        targetSeatId = openSeat.id;
        break;
      }
    }
  } else if (tableId && tableId !== "none" && tableId !== "unassigned" && tableId !== "") {
    const targetTable = await prisma.diningTable.findUnique({
      where: { id: String(tableId) },
      include: { seats: { include: { seatingAssignment: true } } },
    });

    if (targetTable) {
      const openSeat = targetTable.seats.find((s: any) => !s.seatingAssignment);
      if (openSeat) {
        targetSeatId = openSeat.id;
      }
    }
  }

  const code = inputCode ? String(inputCode).trim() : await generateUnique4DigitCode();

  return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const guest = await tx.guest.create({
      data: {
        eventId: event.id,
        fullName: name,
        phone,
        notes: notes || null,
        pin: code,
        pinHash: code,
        pinFingerprint: code,
        qrCode: {
          create: { code },
        },
      },
    });

    if (targetSeatId) {
      const isTaken = await tx.seatingAssignment.findUnique({
        where: { seatId: targetSeatId },
      });
      if (!isTaken) {
        await tx.seatingAssignment.create({
          data: {
            guestId: guest.id,
            seatId: targetSeatId,
          },
        }).catch(() => {});
      }
    }

    if (role) {
      const roleRecord = await tx.role.upsert({
        where: { name: role },
        update: {},
        create: { name: role },
      });

      await tx.guestRole.create({
        data: {
          guestId: guest.id,
          roleId: roleRecord.id,
          eventId: event.id,
        },
      });
    }

    const createdGuest = await tx.guest.findUnique({
      where: { id: guest.id },
      include: includeRelations,
    });

    await createAuditLog(
      {
        actorType: "ADMIN",
        actorId: "admin",
        action: "CREATE",
        entityType: "GUEST",
        entityId: createdGuest?.id || "unknown",
        metadata: { name: createdGuest?.fullName, code: createdGuest?.pin, role },
      },
      tx
    );

    return formatGuest(createdGuest);
  });
}
