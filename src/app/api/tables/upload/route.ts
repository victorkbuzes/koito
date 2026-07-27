import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getDefaultEvent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const event = await getDefaultEvent();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    if (rows.length === 0) {
      return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    const clean = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    for (const row of rows) {
      const getVal = (keys: string[]) => {
        for (const k of keys) {
          const targetClean = clean(k);
          const match = Object.keys(row).find((rk) => clean(rk) === targetClean);
          if (match && row[match] !== undefined && row[match] !== null && String(row[match]).trim() !== "") {
            return String(row[match]).trim();
          }
        }
        for (const k of keys) {
          const targetClean = clean(k);
          const match = Object.keys(row).find((rk) => clean(rk).includes(targetClean));
          if (match && row[match] !== undefined && row[match] !== null && String(row[match]).trim() !== "") {
            return String(row[match]).trim();
          }
        }
        return "";
      };

      let rawTableName = getVal(["table name", "table_name", "table #", "table number", "table", "number", "tablename", "table_no", "no"]);
      const rawCapacity = getVal([
        "number of chairs",
        "no of chairs",
        "no. of chairs",
        "chairs",
        "chair",
        "number of seats",
        "no of seats",
        "seats",
        "capacity",
        "max seats",
        "size",
        "chair count",
        "chairs count",
        "total seats"
      ]);
      const rawZone = getVal(["zone", "table zone", "zone name", "zone_name", "section", "area"]);
      const tableType = getVal(["table type", "type", "shape"]);
      const descriptionVal = getVal(["description", "notes", "details"]);

      if (!rawTableName) {
        skippedCount++;
        continue;
      }

      const tableName = !isNaN(Number(rawTableName)) ? `Table ${rawTableName}` : rawTableName;
      const capacity = parseInt(rawCapacity) || 10;
      const zone = rawZone || null;
      const description = descriptionVal || (tableType ? `Type: ${tableType}` : null);

      const existingTable = await prisma.diningTable.findFirst({
        where: {
          eventId: event.id,
          OR: [
            { name: tableName },
            { name: rawTableName },
          ],
        },
        include: { seats: true },
      });

      if (existingTable) {
        await prisma.diningTable.update({
          where: { id: existingTable.id },
          data: {
            name: tableName,
            ...(zone ? { zone } : {}),
            ...(description ? { description } : {}),
          },
        });

        const currentSeatCount = existingTable.seats.length;
        if (capacity > currentSeatCount) {
          const newSeatsData = Array.from({ length: capacity - currentSeatCount }, (_, i) => ({
            diningTableId: existingTable.id,
            seatNumber: currentSeatCount + i + 1,
          }));
          await prisma.seat.createMany({ data: newSeatsData });
        } else if (capacity < currentSeatCount) {
          const seatsToDelete = await prisma.seat.findMany({
            where: {
              diningTableId: existingTable.id,
              seatingAssignment: null,
            },
            orderBy: { seatNumber: "desc" },
            take: currentSeatCount - capacity,
            select: { id: true },
          });
          if (seatsToDelete.length > 0) {
            await prisma.seat.deleteMany({
              where: { id: { in: seatsToDelete.map((s) => s.id) } },
            });
          }
        }
        updatedCount++;
      } else {
        await prisma.$transaction(async (tx) => {
          const created = await tx.diningTable.create({
            data: {
              eventId: event.id,
              name: tableName,
              zone: zone || null,
              description: description || null,
            },
          });
          const seatsData = Array.from({ length: capacity }, (_, i) => ({
            diningTableId: created.id,
            seatNumber: i + 1,
          }));
          await tx.seat.createMany({ data: seatsData });
        });
        createdCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Tables import complete: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
      createdCount,
      updatedCount,
      skippedCount,
      totalProcessed: rows.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
