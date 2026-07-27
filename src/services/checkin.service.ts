import { prisma } from "@/lib/prisma";
import { getDefaultEvent, formatGuest } from "@/lib/utils";
import { createAuditLog } from "./audit.service";
import type { CheckInScanResult } from "@prisma/client";

export interface VerifyCodeResult {
  id: string;
  name: string;
  code: string;
  role: string;
  table: string;
  status: "CHECKED_IN" | "INVITED";
  checkedIn: boolean;
  isAdmin: boolean;
}

const includeGuestDetails = {
  qrCode: true,
  checkIn: true,
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
 * Service function to verify a guest code or PIN.
 */
export async function verifyGuestCode(code: string): Promise<VerifyCodeResult> {
  const queryCode = code.trim();
  await getDefaultEvent();

  const guest = await prisma.guest.findFirst({
    where: {
      OR: [
        { pin: queryCode },
        { qrCode: { code: queryCode } },
        { pinFingerprint: queryCode },
      ],
    },
    include: includeGuestDetails,
  });

  if (!guest) {
    await createAuditLog({
      actorType: "SYSTEM",
      actorId: "anonymous",
      action: "VERIFY_FAILED",
      entityType: "AUTH",
      entityId: queryCode,
      metadata: { code: queryCode, reason: "Guest or code not found" },
    });
    throw new Error("INVALID_CODE");
  }

  const roleName = guest.guestRoles[0]?.role?.name || "Delegate";
  const isAdmin = guest.guestRoles.some(
    (gr) => gr.role?.name?.toUpperCase() === "ADMIN"
  );
  const tableName = guest.seatingAssignment?.seat?.diningTable?.name || "Unassigned";
  const checkedIn = Boolean(guest.checkIn);

  await createAuditLog({
    actorType: isAdmin ? "ADMIN" : "GUEST",
    actorId: guest.id,
    action: "VERIFY",
    entityType: "GUEST",
    entityId: guest.id,
    metadata: { code: queryCode, checkedIn, role: roleName },
  });

  return {
    id: guest.id,
    name: guest.fullName,
    code: guest.pin || guest.qrCode?.code || queryCode,
    role: roleName,
    table: tableName,
    status: checkedIn ? "CHECKED_IN" : "INVITED",
    checkedIn,
    isAdmin,
  };
}

export interface CheckInInput {
  code?: string;
  delegateId?: string;
  tableId?: string | number | null;
  seatNumber?: number | string | null;
}

/**
 * Service function to perform official guest check-in (with optional table assignment).
 * Records operational scan history (`CheckInScan`), updates `CheckIn`, and writes `AuditLog`.
 */
export async function processCheckIn(input: CheckInInput) {
  const { code, delegateId, tableId, seatNumber } = input;

  let guest: any = null;

  if (delegateId) {
    guest = await prisma.guest.findUnique({
      where: { id: String(delegateId) },
      include: includeGuestDetails,
    });
  } else if (code) {
    const qrRecord = await prisma.qRCode.findUnique({
      where: { code: String(code).trim() },
      include: {
        guest: {
          include: includeGuestDetails,
        },
      },
    });
    guest = qrRecord?.guest || null;
  }

  if (!guest) {
    throw new Error("INVALID_GUEST");
  }

  const alreadyCheckedIn = Boolean(guest.checkIn);
  const scanResult: CheckInScanResult = alreadyCheckedIn ? "DUPLICATE" : "SUCCESS";

  return await prisma.$transaction(async (tx) => {
    // Optional table/seat assignment logic during check-in
    if (tableId !== undefined && tableId !== null && tableId !== "") {
      const targetTable = await tx.diningTable.findUnique({
        where: { id: String(tableId) },
        include: { seats: { include: { seatingAssignment: true } } },
      });

      if (targetTable) {
        const alreadyHasSeat = targetTable.seats.find(
          (s) => s.seatingAssignment?.guestId === guest.id
        );

        if (!alreadyHasSeat) {
          let availableSeat = null;
          if (seatNumber) {
            availableSeat = targetTable.seats.find((s) => s.seatNumber === parseInt(String(seatNumber)));
          }
          if (!availableSeat) {
            availableSeat = targetTable.seats.find((s) => !s.seatingAssignment);
          }

          if (!availableSeat) {
            throw new Error(`TABLE_FULL:${targetTable.name}:${targetTable.seats.length}`);
          }

          if (guest.seatingAssignment) {
            await tx.seatingAssignment.delete({
              where: { id: guest.seatingAssignment.id },
            });
          }

          const isSeatTaken = await tx.seatingAssignment.findUnique({
            where: { seatId: availableSeat.id },
          });

          if (!isSeatTaken) {
            await tx.seatingAssignment.create({
              data: {
                guestId: guest.id,
                seatId: availableSeat.id,
              },
            }).catch(() => {});
          }
        }
      }
    }

    // 1. Record operational scan history
    await tx.checkInScan.create({
      data: {
        guestId: guest.id,
        result: scanResult,
        scannedAt: new Date(),
        message: alreadyCheckedIn ? "Duplicate check-in scan" : "Successful check-in",
      },
    });

    // 2. Upsert check-in state
    await tx.checkIn.upsert({
      where: { guestId: guest.id },
      update: { checkedInAt: new Date() },
      create: { guestId: guest.id, checkedInAt: new Date() },
    });

    // 3. Fetch updated guest state
    const updatedGuest = await tx.guest.findUnique({
      where: { id: guest.id },
      include: includeGuestDetails,
    });

    const roleName = updatedGuest?.guestRoles[0]?.role?.name || "Delegate";
    const tableName = updatedGuest?.seatingAssignment?.seat?.diningTable?.name || "Unassigned";
    const formattedDelegate = formatGuest(updatedGuest);

    // 4. Log Audit inside transaction
    await createAuditLog(
      {
        actorType: roleName.toUpperCase() === "ADMIN" ? "ADMIN" : "GUEST",
        actorId: guest.id,
        action: "CHECK_IN",
        entityType: "CHECK_IN",
        entityId: guest.id,
        metadata: { code, guestName: guest.fullName, role: roleName, table: tableName, scanResult },
      },
      tx
    );

    return {
      message: alreadyCheckedIn ? "Already checked in (updated timestamp)" : "Attendance confirmed!",
      id: updatedGuest?.id,
      name: updatedGuest?.fullName,
      code: updatedGuest?.qrCode?.code || code,
      role: roleName,
      table: tableName,
      status: "CHECKED_IN",
      checkedIn: true,
      delegate: formattedDelegate,
    };
  });
}

/**
 * Service function to revoke / undo a guest check-in.
 */
export async function revokeCheckIn(input: CheckInInput) {
  const { code, delegateId } = input;
  let guest: any = null;

  if (delegateId) {
    guest = await prisma.guest.findUnique({
      where: { id: String(delegateId) },
      include: includeGuestDetails,
    });
  } else if (code) {
    const qrRecord = await prisma.qRCode.findUnique({
      where: { code: String(code).trim() },
      include: {
        guest: {
          include: includeGuestDetails,
        },
      },
    });
    guest = qrRecord?.guest || null;
  }

  if (!guest) {
    throw new Error("INVALID_GUEST");
  }

  return await prisma.$transaction(async (tx) => {
    // Delete check-in record
    await tx.checkIn.deleteMany({
      where: { guestId: guest.id },
    });

    const updatedGuest = await tx.guest.findUnique({
      where: { id: guest.id },
      include: includeGuestDetails,
    });

    const formattedDelegate = formatGuest(updatedGuest);

    await createAuditLog(
      {
        actorType: "ADMIN",
        actorId: guest.id,
        action: "REMOVE",
        entityType: "CHECK_IN",
        entityId: guest.id,
        metadata: { actionDetail: "CHECK_IN_REVOKED", code, guestName: guest.fullName },
      },
      tx
    );

    return {
      message: `Check-in revoked for ${guest.fullName}`,
      id: updatedGuest?.id,
      name: updatedGuest?.fullName,
      code: updatedGuest?.qrCode?.code || code,
      status: "INVITED",
      checkedIn: false,
      delegate: formattedDelegate,
    };
  });
}
