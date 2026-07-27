import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { generateUnique4DigitCode, generateUniqueAdminCode, normalizePhone, getDefaultEvent } from "@/lib/utils";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function normalizeTitle(raw) {
  if (!raw) return "";
  const cleaned = String(raw).trim().replace(/\.$/, "").toLowerCase();
  const titleMap = {
    mr: "Mr.",
    mrs: "Mrs.",
    ms: "Ms.",
    miss: "Miss",
    dr: "Dr.",
    doctor: "Dr.",
    hon: "Hon.",
    honorable: "Hon.",
    honourable: "Hon.",
    prof: "Prof.",
    professor: "Prof.",
    eng: "Eng.",
    engineer: "Eng.",
    rev: "Rev.",
    reverend: "Rev.",
    pst: "Pastor",
    pastor: "Pastor",
    amb: "Amb.",
    ambassador: "Amb.",
    he: "H.E.",
    gen: "Gen.",
    general: "Gen.",
    capt: "Capt.",
    captain: "Capt.",
    col: "Col.",
    colonel: "Col.",
    chief: "Chief",
    elder: "Elder",
  };
  if (titleMap[cleaned]) return titleMap[cleaned];
  return String(raw).trim().charAt(0).toUpperCase() + String(raw).trim().slice(1);
}

function normalizeCountyCountry(raw) {
  if (!raw) return "";
  const cleaned = String(raw).trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .map((word) => {
      const u = word.toUpperCase();
      if (u === "UK" || u === "US" || u === "USA" || u === "UAE") return u;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const autoAssignTable = (formData.get("autoAssignTable") ?? "false") === "true";

    if (!file) {
      return Response.json({ error: "No file uploaded" }, { status: 400 });
    }

    const event = await getDefaultEvent();

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const guestsSheetName =
      workbook.SheetNames.find((s) =>
        ["delegates", "guests", "members", "attendees"].includes(s.toLowerCase().trim())
      ) || workbook.SheetNames[0];

    const worksheet = workbook.Sheets[guestsSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (rows.length === 0) {
      return Response.json({ error: "Uploaded sheet is empty" }, { status: 400 });
    }

    let tablesMap = new Map();
    const dbTables = await prisma.diningTable.findMany({
      where: { eventId: event.id },
      include: { seats: { include: { seatingAssignment: true } } },
    });
    for (const t of dbTables) {
      tablesMap.set(t.name.toLowerCase().trim(), t);
    }

    const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    let clustersMap = new Map();
    const dbClusters = await prisma.cluster.findMany({
      where: { eventId: event.id },
    });
    for (const c of dbClusters) {
      clustersMap.set(clean(c.name), c);
    }
    let defaultCluster = dbClusters.find((c) => clean(c.name) === "guests") || dbClusters[0] || null;
    if (!defaultCluster) {
      defaultCluster = await prisma.cluster.create({
        data: {
          eventId: event.id,
          name: "Guests",
          description: "Honored Guests and General Attendees",
        },
      });
      clustersMap.set(clean("Guests"), defaultCluster);
    }

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const assignedSeatIds = new Set();

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];

      const getVal = (keys) => {
        // First pass: exact clean match
        for (const k of keys) {
          const targetClean = clean(k);
          const match = Object.keys(row).find((rk) => clean(rk) === targetClean);
          if (match && row[match] !== undefined && row[match] !== null && String(row[match]).trim() !== "") {
            return String(row[match]).trim();
          }
        }
        // Second pass: contains / alias match
        for (const k of keys) {
          const targetClean = clean(k);
          const match = Object.keys(row).find((rk) => {
            const rkClean = clean(rk);
            if (targetClean === "name" && rkClean.includes("table")) return false;
            return rkClean.includes(targetClean);
          });
          if (match && row[match] !== undefined && row[match] !== null && String(row[match]).trim() !== "") {
            return String(row[match]).trim();
          }
        }
        return "";
      };

      let name = getVal(['full name', 'fullname', 'guest name', 'delegate name', 'member', 'Name*', 'guest', 'guests', 'delegate', 'attendee', 'person', 'names', 'name']);

      if (!name) {
        const firstName = getVal(['first name', 'firstname', 'given name']);
        const lastName = getVal(['last name', 'lastname', 'surname', 'family name']);
        if (firstName || lastName) {
          name = `${firstName} ${lastName}`.trim();
        }
      }

      const rawPhone = getVal(["phone", "phone number", "mobile", "telephone", "contact"]);
      const role = getVal(["role", "category"]);
      const rawTitle = getVal(["title", "salutation", "honorific", "prefix"]);
      const rawCountry = getVal(["country", "county", "location", "residence", "region", "state", "city", "origin"]);
      const rawCluster = getVal(["cluster", "cluster name", "cluster_name", "delegation", "group"]);
      const specifiedTableName = getVal(["table", "table name", "assigned table", "seating", "table_name", "dining table", "table #"]);
      const rawSeat = getVal(["seat", "seat number", "seat_number", "chair"]);

      if (!name) {
        skippedCount++;
        console.warn(`⚠️ [EXCEL IMPORT] Row ${index + 1} skipped because no valid name column was matched. Keys in row:`, Object.keys(row));
        continue;
      }

      const title = normalizeTitle(rawTitle);
      const country = normalizeCountyCountry(rawCountry);

      let titleRecord = null;
      if (title) {
        titleRecord = await prisma.title.upsert({
          where: { name: title },
          update: {},
          create: { name: title },
        });
      }

      const customCode = getVal(["code", "pin", "passcode", "qr code"]);
      const phone = normalizePhone(rawPhone);
      const parsedSeatNumber = rawSeat ? parseInt(rawSeat) || null : null;

      // Determine Cluster strictly against existing database clusters
      let targetClusterId = defaultCluster ? defaultCluster.id : null;
      if (rawCluster) {
        const cleanRawCluster = clean(rawCluster);
        const matchedCluster = clustersMap.get(cleanRawCluster);
        if (matchedCluster) {
          targetClusterId = matchedCluster.id;
        }
      }

      let targetSeatId = null;

      if (specifiedTableName) {
        const key = specifiedTableName.toLowerCase().trim();
        let targetTable = tablesMap.get(key);

        if (targetTable) {
          let seat = null;
          if (parsedSeatNumber) {
            seat = targetTable.seats.find((s) => s.seatNumber === parsedSeatNumber && !s.seatingAssignment && !assignedSeatIds.has(s.id));
          }
          if (!seat) {
            seat = targetTable.seats.find((s) => !s.seatingAssignment && !assignedSeatIds.has(s.id));
          }
          if (seat) {
            targetSeatId = seat.id;
            assignedSeatIds.add(seat.id);
          }
        }
      } else if (autoAssignTable && dbTables.length > 0) {
        for (const [_, tbl] of tablesMap.entries()) {
          const seat = tbl.seats.find((s) => !s.seatingAssignment && !assignedSeatIds.has(s.id));
          if (seat) {
            targetSeatId = seat.id;
            assignedSeatIds.add(seat.id);
            break;
          }
        }
      }

      let existingGuest = null;
      if (phone) {
        existingGuest = await prisma.guest.findFirst({
          where: { phone, eventId: event.id },
          include: { seatingAssignment: true, qrCode: true },
        });
      }
      if (!existingGuest && customCode) {
        const qrRecord = await prisma.qRCode.findUnique({
          where: { code: customCode },
          include: { guest: { include: { seatingAssignment: true, qrCode: true } } },
        });
        existingGuest = qrRecord?.guest || null;
      }
      if (!existingGuest && name) {
        existingGuest = await prisma.guest.findFirst({
          where: { fullName: name, eventId: event.id },
          include: { seatingAssignment: true, qrCode: true },
        });
      }

      if (existingGuest) {
        const updateData = {};
        if (name) updateData.fullName = name;
        if (targetClusterId) updateData.clusterId = targetClusterId;
        if (titleRecord) updateData.titleId = titleRecord.id;
        if (country) updateData.country = country;

        await prisma.guest.update({
          where: { id: existingGuest.id },
          data: updateData,
        });

        if (targetSeatId && !existingGuest.seatingAssignment) {
          const isTaken = await prisma.seatingAssignment.findUnique({
            where: { seatId: targetSeatId },
          });
          if (!isTaken) {
            await prisma.seatingAssignment.create({
              data: {
                guestId: existingGuest.id,
                seatId: targetSeatId,
              },
            }).catch(() => {});
          }
        }
        updatedCount++;
      } else {
        const isAdminRole = role?.toUpperCase() === "ADMIN";
        const code = customCode ||
          (isAdminRole ? await generateUniqueAdminCode() : await generateUnique4DigitCode());

        await prisma.$transaction(async (tx) => {
          const createdGuest = await tx.guest.create({
            data: {
              eventId: event.id,
              fullName: name,
              phone: phone || null,
              clusterId: targetClusterId,
              titleId: titleRecord ? titleRecord.id : null,
              country: country || null,
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
                  guestId: createdGuest.id,
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
                guestId: createdGuest.id,
                roleId: roleRecord.id,
                eventId: event.id,
              },
            });
          }
        });
        addedCount++;
      }
    }

    await logAudit({
      actorType: "ADMIN",
      actorId: "admin",
      action: "IMPORT",
      entityType: "GUEST",
      entityId: event.id,
      metadata: { fileName: file.name, addedCount, updatedCount, skippedCount, totalProcessed: rows.length },
    });

    return Response.json({
      success: true,
      message: `Import finished: ${addedCount} new delegates added, ${updatedCount} updated, ${skippedCount} skipped.`,
      addedCount,
      updatedCount,
      skippedCount,
      totalProcessed: rows.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
