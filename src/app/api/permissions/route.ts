import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const permissions = await prisma.permission.findMany({
      include: {
        roles: {
          include: { role: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      permissions: permissions.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        roleCount: p.roles.length,
        roles: p.roles.map((rp) => ({
          id: rp.role.id,
          name: rp.role.name,
        })),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (err) {
    console.error("[PERMISSIONS API] Error fetching permissions:", err);
    return NextResponse.json({ error: "Failed to fetch permissions" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, description } = await req.json();
    if (!name?.trim()) {
      return NextResponse.json({ error: "Permission name is required" }, { status: 400 });
    }
    const permission = await prisma.permission.create({
      data: { name: name.trim(), description: description?.trim() || null },
    });
    return NextResponse.json({ permission }, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "A permission with that name already exists" }, { status: 409 });
    }
    console.error("[PERMISSIONS API] Error creating permission:", err);
    return NextResponse.json({ error: "Failed to create permission" }, { status: 500 });
  }
}
