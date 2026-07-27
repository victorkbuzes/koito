import { prisma } from "./prisma";

// Normalize phone numbers by removing spaces, dashes, parentheses
export function normalizePhone(
  phone: string | number | null | undefined,
): string | null {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^\d+]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

// Get or auto-create default Event with seeded Roles, Titles, and Admin A000
export async function getDefaultEvent() {
  let event = await prisma.event.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!event) {
    event = await prisma.event.create({
      data: {
        id: "default-koito-event-2026",
        name: "Koito Annual Gala 2026",
        venue: "Grand Ballroom",
        description: "Official Koito Event & High-Level Gala Dinner",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86400000 * 365),
        status: "ACTIVE",
      },
    });

    // Auto-seed Roles
    const defaultRoles = [
      {
        name: "ADMIN",
        description: "Full system administration & desk management",
      },
      { name: "VIP", description: "Very Important Person / Dignitary" },
      { name: "Speaker", description: "Keynote & Panel Presenter" },
      { name: "Delegate", description: "General Confirmed Delegate" },
      { name: "Honored Guest", description: "Invited High-Level Guest" },
      { name: "Organizer", description: "Event Coordination Team" },
      { name: "Press", description: "Accredited Media & Press" },
    ];
    for (const r of defaultRoles) {
      await prisma.role.upsert({
        where: { name: r.name },
        update: {},
        create: r,
      });
    }

    // Auto-seed Titles
    const defaultTitles = [
      "H.E.",
      "Hon.",
      "Dr.",
      "Prof.",
      "Ambassador",
      "Eng.",
      "Gen.",
      "Mr.",
      "Ms.",
      "Mrs.",
    ];
    for (const name of defaultTitles) {
      await prisma.title.upsert({
        where: { name },
        update: {},
        create: { name },
      });
    }

    // Auto-seed Clusters
    const defaultClusters = [
      { name: "Executive Delegation" },
      { name: "Ministry & State" },
      { name: "Corporate Partners" },
      { name: "Keynote Speakers" },
      { name: "General Attendees" },
    ];
    for (const c of defaultClusters) {
      await prisma.cluster.upsert({
        where: { eventId_name: { eventId: event.id, name: c.name } },
        update: {},
        create: { eventId: event.id, ...c },
      });
    }

    // Auto-seed Admin Guest A000
    const adminRole = await prisma.role.findUnique({
      where: { name: "ADMIN" },
    });
    const adminGuest = await prisma.guest.upsert({
      where: {
        eventId_pinFingerprint: { eventId: event.id, pinFingerprint: "A000" },
      },
      update: {},
      create: {
        eventId: event.id,
        fullName: "System Administrator",
        pin: "A000",
        pinHash: "A000",
        pinFingerprint: "A000",
        notes: "System Admin Account",
      },
    });

    await prisma.qRCode.upsert({
      where: { code: "A000" },
      update: {},
      create: { guestId: adminGuest.id, code: "A000" },
    });

    if (adminRole) {
      await prisma.guestRole.upsert({
        where: {
          guestId_roleId_eventId: {
            guestId: adminGuest.id,
            roleId: adminRole.id,
            eventId: event.id,
          },
        },
        update: {},
        create: {
          guestId: adminGuest.id,
          roleId: adminRole.id,
          eventId: event.id,
        },
      });
    }

    await prisma.checkIn.upsert({
      where: { guestId: adminGuest.id },
      update: {},
      create: { guestId: adminGuest.id, checkedInAt: new Date() },
    });
  }

  return event;
}

// Generate a unique 4-digit all-numeric code for guests (1000–9999)
export async function generateUnique4DigitCode() {
  let code = "";
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 10000) {
    code = Math.floor(1000 + Math.random() * 9000).toString();

    // Check if code already exists in PostgreSQL database
    const existing = await prisma.qRCode.findUnique({
      where: { code },
    });

    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error(
      "Unable to generate a unique 4-digit code. All 4-digit codes are in use.",
    );
  }

  return code;
}

// Generate a unique alphanumeric admin code: A000–A999
// Admin codes are always 4 chars starting with "A" — visually distinct from guest codes.
export async function generateUniqueAdminCode() {
  let code = "";
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 1000) {
    const num = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    code = `A${num}`;

    // A000 is reserved as the default system admin — skip it during auto-generation
    if (code === "A000") {
      attempts++;
      continue;
    }

    const existing = await prisma.qRCode.findUnique({
      where: { code },
    });

    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error(
      "Unable to generate a unique admin code. All A000–A999 codes are in use.",
    );
  }

  return code;
}

// Format Prisma Guest model into frontend-compatible Delegate shape
export function formatGuest(guest: any) {
  if (!guest) return null;
  const roleName =
    guest.guestRoles && guest.guestRoles.length > 0
      ? guest.guestRoles[0].role?.name
      : "Delegate";
  const clusterName = guest.cluster?.name || "General";
  const table = guest.seatingAssignment?.seat?.diningTable || null;
  const seatNumber = guest.seatingAssignment?.seat?.seatNumber || null;
  const code = guest.qrCode?.code || "";
  const checkedIn = Boolean(guest.checkIn);
  const rsvpStatus =
    guest.rsvp?.status || (checkedIn ? "ATTENDING" : "PENDING");

  return {
    id: guest.id,
    code,
    name: guest.fullName,
    phone: guest.phone || null,
    cluster: clusterName,
    role: roleName || "Delegate",
    status: checkedIn ? "CHECKED_IN" : "INVITED",
    rsvpStatus,
    tableId: table?.id || null,
    seatNumber,
    table: table ? { id: table.id, name: table.name } : null,
    notes: guest.notes || null,
    checkedInAt: guest.checkIn?.checkedInAt || null,
    dietary: guest.dietaryRequirements || guest.rsvp?.guestNotes || null,
    createdAt: guest.createdAt,
    updatedAt: guest.updatedAt,
  };
}
