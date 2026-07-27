import { prisma } from "@/lib/prisma";
import { createAuditLog } from "./audit.service";
import { formatGuest, getDefaultEvent } from "@/lib/utils";
import type { RSVPStatus } from "@prisma/client";

export interface SubmitRsvpInput {
  code?: string;
  pin?: string;
  guestId?: string;
  attending: string;
  dietary?: string;
  message?: string;
  notes?: string;
}

/**
 * Service function to retrieve all RSVPs with summary statistics.
 */
export async function getRsvpSummary() {
  const rsvps = await prisma.rSVP.findMany({
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
    orderBy: { updatedAt: "desc" },
  });

  const formattedRsvps = rsvps.map((r) => ({
    id: r.id,
    guestId: r.guestId,
    name: r.guest.fullName,
    pin: r.guest.pin || r.guest.qrCode?.code || "",
    attending: r.status === "ATTENDING" ? "yes" : "no",
    status: r.status,
    guestName: r.guest.fullName,
    dietary: r.guestNotes || r.guest.dietaryRequirements || "",
    message: r.guestNotes || "",
    respondedAt: r.respondedAt || r.updatedAt,
    timestamp: (r.respondedAt || r.updatedAt).toISOString(),
  }));

  return {
    rsvps: formattedRsvps,
    total: formattedRsvps.length,
    attendingCount: formattedRsvps.filter((r) => r.attending === "yes").length,
    declinedCount: formattedRsvps.filter((r) => r.attending === "no").length,
  };
}

/**
 * Service function to submit or update a Guest RSVP.
 * Guarantees permanent persistence in PostgreSQL (auto-creates Guest if needed).
 */
export async function submitRsvp(input: SubmitRsvpInput) {
  const { code, pin, guestId, attending, dietary, message, notes } = input;
  const queryCode = (code || pin || "").trim();

  let guest: any = null;

  if (guestId) {
    guest = await prisma.guest.findUnique({
      where: { id: String(guestId) },
      include: {
        qrCode: true,
        checkIn: true,
        rsvp: true,
        guestRoles: { include: { role: true } },
      },
    });
  }

  if (!guest && queryCode) {
    guest = await prisma.guest.findFirst({
      where: {
        OR: [
          { pin: queryCode },
          { qrCode: { code: queryCode } },
          { pinFingerprint: queryCode },
          { fullName: { equals: queryCode, mode: "insensitive" } },
        ],
      },
      include: {
        qrCode: true,
        checkIn: true,
        rsvp: true,
        guestRoles: { include: { role: true } },
      },
    });
  }

  // If guest still doesn't exist in DB, auto-create Guest so RSVP is permanently stored in PostgreSQL
  if (!guest && queryCode) {
    const event = await getDefaultEvent();
    guest = await prisma.guest.create({
      data: {
        eventId: event.id,
        fullName: queryCode,
        pin: queryCode,
        pinHash: queryCode,
        pinFingerprint: queryCode,
        qrCode: {
          create: { code: queryCode },
        },
      },
      include: {
        qrCode: true,
        checkIn: true,
        rsvp: true,
        guestRoles: { include: { role: true } },
      },
    });
  }

  if (!guest) {
    throw new Error("GUEST_NOT_FOUND");
  }

  const rsvpStatus: RSVPStatus =
    attending === "yes" || attending === "ATTENDING" ? "ATTENDING" : "NOT_ATTENDING";
  const guestNotesText = [dietary, message, notes].filter(Boolean).join(" | ") || null;

  return await prisma.$transaction(async (tx) => {
    // 1. Upsert RSVP record in PostgreSQL
    const rsvpRecord = await tx.rSVP.upsert({
      where: { guestId: guest.id },
      update: {
        status: rsvpStatus,
        respondedAt: new Date(),
        guestNotes: guestNotesText,
      },
      create: {
        guestId: guest.id,
        status: rsvpStatus,
        respondedAt: new Date(),
        guestNotes: guestNotesText,
      },
    });

    // 2. Optionally update guest dietary requirements / notes
    if (dietary || notes) {
      await tx.guest.update({
        where: { id: guest.id },
        data: {
          dietaryRequirements: dietary || undefined,
          notes: notes || undefined,
        },
      });
    }

    // 3. Log Audit inside transaction
    await createAuditLog(
      {
        actorType: "GUEST",
        actorId: guest.id,
        action: "RSVP_SUBMIT",
        entityType: "RSVP",
        entityId: rsvpRecord.id,
        metadata: { guestName: guest.fullName, status: rsvpStatus, dietary },
      },
      tx
    );

    // 4. Fetch updated guest state
    const updatedGuest = await tx.guest.findUnique({
      where: { id: guest.id },
      include: {
        qrCode: true,
        checkIn: true,
        rsvp: true,
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
    });

    return {
      message: "RSVP saved successfully to database",
      rsvp: {
        id: rsvpRecord.id,
        status: rsvpRecord.status,
        attending: rsvpRecord.status === "ATTENDING" ? "yes" : "no",
        respondedAt: rsvpRecord.respondedAt,
      },
      delegate: formatGuest(updatedGuest),
    };
  });
}
