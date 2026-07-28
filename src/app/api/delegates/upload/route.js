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
    // Read raw 2D array matrix [ [row0_col0, row0_col1, ...], [row1_col0, ...] ]
    const rawMatrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    if (!rawMatrix || rawMatrix.length === 0) {
      return Response.json({ error: "Uploaded sheet is empty" }, { status: 400 });
    }

    const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    let tablesMap = new Map();
    const dbTables = await prisma.diningTable.findMany({
      where: { eventId: event.id },
      include: { seats: { include: { seatingAssignment: true } } },
    });
    for (const t of dbTables) {
      tablesMap.set(t.name.toLowerCase().trim(), t);
    }

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

    // 1. Detect if any of the first 5 rows is a Header Row
    let headerRowIndex = -1;
    const colMap = {
      name: -1,
      title: -1,
      phone: -1,
      cluster: -1,
      country: -1,
      table: -1,
      seat: -1,
      role: -1,
      code: -1,
    };

    const HEADER_KEYWORDS = [
      "fullname", "full name", "guest name", "delegate name", "member name", "attendee name",
      "person name", "names", "name", "phone", "phone number", "mobile", "telephone", "contact",
      "title", "salutation", "honorific", "cluster", "delegation", "group", "country", "county"
    ];

    for (let r = 0; r < Math.min(5, rawMatrix.length); r++) {
      const rowCells = rawMatrix[r];
      if (!Array.isArray(rowCells)) continue;

      let matchCount = 0;
      rowCells.forEach((cell) => {
        const cClean = clean(cell);
        if (!cClean) return;
        if (HEADER_KEYWORDS.some((kw) => clean(kw) === cClean || (cClean.includes(clean(kw)) && !cClean.includes("samoei") && !cClean.includes("ruto")))) {
          matchCount++;
        }
      });

      if (matchCount >= 2 || (matchCount >= 1 && rowCells.some(c => clean(c) === "name" || clean(c) === "fullname"))) {
        headerRowIndex = r;
        rowCells.forEach((cell, idx) => {
          const cClean = clean(cell);
          if (colMap.name === -1 && (cClean.includes("name") || cClean.includes("member") || cClean.includes("guest") || cClean.includes("delegate") || cClean.includes("person"))) {
            colMap.name = idx;
          } else if (colMap.title === -1 && (cClean.includes("title") || cClean.includes("salutation") || cClean.includes("prefix") || cClean.includes("honorific"))) {
            colMap.title = idx;
          } else if (colMap.phone === -1 && (cClean.includes("phone") || cClean.includes("mobile") || cClean.includes("telephone") || cClean.includes("contact"))) {
            colMap.phone = idx;
          } else if (colMap.cluster === -1 && (cClean.includes("cluster") || cClean.includes("delegation") || cClean.includes("group"))) {
            colMap.cluster = idx;
          } else if (colMap.country === -1 && (cClean.includes("country") || cClean.includes("county") || cClean.includes("location") || cClean.includes("residence"))) {
            colMap.country = idx;
          } else if (colMap.table === -1 && (cClean.includes("table") || cClean.includes("seating"))) {
            colMap.table = idx;
          } else if (colMap.seat === -1 && (cClean.includes("seat") || cClean.includes("chair"))) {
            colMap.seat = idx;
          } else if (colMap.role === -1 && (cClean.includes("role") || cClean.includes("category"))) {
            colMap.role = idx;
          } else if (colMap.code === -1 && (cClean.includes("code") || cClean.includes("pin"))) {
            colMap.code = idx;
          }
        });
        break;
      }
    }

    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
    const hasHeaderMapping = colMap.name !== -1;

    console.log(`📊 [EXCEL IMPORT START] Total raw rows: ${rawMatrix.length}, Has Headers: ${hasHeaderMapping}, Start Row Index: ${startRow}`);

    const KNOWN_TITLES = [
      "mr", "mrs", "ms", "miss", "dr", "doctor", "hon", "honorable", "honourable",
      "prof", "professor", "eng", "engineer", "rev", "reverend", "pst", "pastor",
      "amb", "ambassador", "he", "gen", "general", "capt", "captain", "col", "colonel",
      "chief", "elder"
    ];

    let addedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const assignedSeatIds = new Set();
    const recordLogs = [];

    for (let r = startRow; r < rawMatrix.length; r++) {
      const rowCells = rawMatrix[r];
      if (!Array.isArray(rowCells) || rowCells.every(c => String(c || "").trim() === "")) {
        continue;
      }

      let name = "";
      let rawTitle = "";
      let rawPhone = "";
      let rawCluster = "";
      let rawCountry = "";
      let specifiedTableName = "";
      let rawSeat = "";
      let role = "";
      let customCode = "";

      if (hasHeaderMapping) {
        name = colMap.name !== -1 ? String(rowCells[colMap.name] || "").trim() : "";
        rawTitle = colMap.title !== -1 ? String(rowCells[colMap.title] || "").trim() : "";
        rawPhone = colMap.phone !== -1 ? String(rowCells[colMap.phone] || "").trim() : "";
        rawCluster = colMap.cluster !== -1 ? String(rowCells[colMap.cluster] || "").trim() : "";
        rawCountry = colMap.country !== -1 ? String(rowCells[colMap.country] || "").trim() : "";
        specifiedTableName = colMap.table !== -1 ? String(rowCells[colMap.table] || "").trim() : "";
        rawSeat = colMap.seat !== -1 ? String(rowCells[colMap.seat] || "").trim() : "";
        role = colMap.role !== -1 ? String(rowCells[colMap.role] || "").trim() : "";
        customCode = colMap.code !== -1 ? String(rowCells[colMap.code] || "").trim() : "";
      } else {
        // Positional extraction for headerless rows
        let posTitle = "";
        let posPhone = "";
        let posCluster = "";
        let posCountry = "";
        const candidateNames = [];

        for (const cell of rowCells) {
          const str = String(cell || "").trim();
          if (!str) continue;

          const lower = str.toLowerCase().replace(/\.$/, "");

          if (!posTitle && KNOWN_TITLES.includes(lower)) {
            posTitle = str;
            continue;
          }

          const digitCount = (str.match(/\d/g) || []).length;
          if (!posPhone && digitCount >= 8 && str.replace(/[^0-9+]/g, "").length >= 8) {
            posPhone = str;
            continue;
          }

          if (/^\d{1,3}$/.test(str)) {
            continue;
          }

          const cleanedToken = clean(str);
          if (!posCluster && clustersMap.has(cleanedToken)) {
            posCluster = str;
            continue;
          }

          candidateNames.push(str);
        }

        if (candidateNames.length > 0) name = candidateNames[0];
        rawTitle = posTitle;
        rawPhone = posPhone;
        rawCluster = posCluster;
        if (candidateNames.length > 1) {
          if (!rawCluster) rawCluster = candidateNames[1];
          else if (!rawCountry) rawCountry = candidateNames[1];
        }
        if (candidateNames.length > 2 && !rawCountry) {
          rawCountry = candidateNames[2];
        }
      }

      const displayRowNum = r + 1;

      if (!name) {
        skippedCount++;
        const reason = "No valid guest name found in row cells.";
        console.warn(`⚠️ [EXCEL IMPORT] Row ${displayRowNum} SKIPPED: ${reason} Row Cells:`, rowCells);
        recordLogs.push({
          row: displayRowNum,
          status: "SKIPPED",
          name: "N/A",
          title: rawTitle || null,
          phone: rawPhone || null,
          reason,
        });
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

      const phone = normalizePhone(rawPhone);
      const parsedSeatNumber = rawSeat ? parseInt(rawSeat) || null : null;

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
        const logDetail = `Row ${displayRowNum} UPDATED: ${name} (Title: ${title || "N/A"}, Phone: ${phone || "N/A"}, PIN: ${existingGuest.pin})`;
        console.log(`ℹ️ [EXCEL IMPORT] ${logDetail}`);
        recordLogs.push({
          row: displayRowNum,
          status: "UPDATED",
          name: name,
          title: title || null,
          phone: phone || null,
          pin: existingGuest.pin,
          reason: `Updated existing guest ID ${existingGuest.id}.`,
        });
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

          // Default role must ALWAYS be "GUEST" from the roles table
          const defaultGuestRole = await tx.role.upsert({
            where: { name: "GUEST" },
            update: { description: "Default Guest Role" },
            create: { name: "GUEST", description: "Default Guest Role" },
          });

          await tx.guestRole.create({
            data: {
              guestId: createdGuest.id,
              roleId: defaultGuestRole.id,
              eventId: event.id,
            },
          });

          // If an additional specific role was provided (and it's not GUEST), assign that too
          if (role && role.toUpperCase().trim() !== "GUEST") {
            const extraRoleName = role.toUpperCase().trim();
            const extraRoleRecord = await tx.role.upsert({
              where: { name: extraRoleName },
              update: {},
              create: { name: extraRoleName, description: `${extraRoleName} Role` },
            });
            await tx.guestRole.create({
              data: {
                guestId: createdGuest.id,
                roleId: extraRoleRecord.id,
                eventId: event.id,
              },
            }).catch(() => {});
          }
        });
        addedCount++;
        const logDetail = `Row ${displayRowNum} ADDED: ${name} (Title: ${title || "N/A"}, Phone: ${phone || "N/A"}, PIN: ${code})`;
        console.log(`✅ [EXCEL IMPORT] ${logDetail}`);
        recordLogs.push({
          row: displayRowNum,
          status: "ADDED",
          name: name,
          title: title || null,
          phone: phone || null,
          pin: code,
          reason: `Created new delegate record with PIN #${code}.`,
        });
      }
    }

    await logAudit({
      actorType: "ADMIN",
      actorId: "admin",
      action: "IMPORT",
      entityType: "GUEST",
      entityId: event.id,
      metadata: { fileName: file.name, addedCount, updatedCount, skippedCount, totalProcessed: rawMatrix.length },
    });

    console.log(`🎉 [EXCEL IMPORT COMPLETE] Added: ${addedCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}`);

    return Response.json({
      success: true,
      message: `Import finished: ${addedCount} new delegates added, ${updatedCount} updated, ${skippedCount} skipped.`,
      addedCount,
      updatedCount,
      skippedCount,
      totalProcessed: rawMatrix.length,
      records: recordLogs,
    });
  } catch (error) {
    console.error("🔴 [EXCEL IMPORT ERROR]:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
