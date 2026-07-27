import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { PAGE_WIDTH, PAGE_HEIGHT, colors } from "./styles.js";
import {
  drawPageFrame,
  drawOrnamentalDivider,
  drawCalendarIcon,
  drawPinIcon,
  drawClockIcon,
  drawCurtainPlaceholder,
} from "./helpers.js";

export async function renderPage1(pdfDoc, fonts, event, guest) {
  const templatePath = path.join(process.cwd(), "public", "ticket-template.pdf");
  const curtainPath1 = path.join(process.cwd(), "public", "elements", "curtain.png");
  const curtainPath2 = path.join(process.cwd(), "public", "elements", "curtain-full.png");
  const curtainImagePath = fs.existsSync(curtainPath1) ? curtainPath1 : curtainPath2;

  let page = null;

  if (fs.existsSync(templatePath)) {
    try {
      const templateBytes = fs.readFileSync(templatePath);
      const templateDoc = await PDFDocument.load(templateBytes);
      if (templateDoc.getPageCount() >= 1) {
        const [copied] = await pdfDoc.copyPages(templateDoc, [0]);
        pdfDoc.addPage(copied);
        page = pdfDoc.getPages()[pdfDoc.getPageCount() - 1];
      }
    } catch (e) {
      console.warn("Could not load public/ticket-template.pdf, using vector fallback:", e);
    }
  }

  if (!page) {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawPageFrame(page);
  }

  // Position side curtain image on the right margin (untouched)
  if (fs.existsSync(curtainImagePath)) {
    try {
      const curtainBytes = fs.readFileSync(curtainImagePath);
      const curtainImage = await pdfDoc.embedPng(curtainBytes);

      const curtainWidth = 235;
      const curtainX = PAGE_WIDTH - curtainWidth; // x = 360.28
      const curtainY = 0;

      page.drawImage(curtainImage, {
        x: curtainX,
        y: curtainY,
        width: curtainWidth,
        height: PAGE_HEIGHT,
      });
    } catch (err) {
      console.warn("Could not embed curtain image, using fallback:", err);
      drawCurtainPlaceholder(page);
    }
  } else {
    drawCurtainPlaceholder(page);
  }

  // Load Flourish Image if available
  let flourishImage = null;
  const flourishCandidates = [
    path.join(process.cwd(), "public", "elements", "flourish.png"),
    path.join(process.cwd(), "public", "elements", "ornament.png"),
    path.join(process.cwd(), "public", "flourish.png"),
  ];
  for (const p of flourishCandidates) {
    if (fs.existsSync(p)) {
      try {
        const bytes = fs.readFileSync(p);
        flourishImage = await pdfDoc.embedPng(bytes);
        break;
      } catch (err) {
        console.warn(`Could not embed flourish image from ${p}:`, err);
      }
    }
  }

  const { serifRegular, serifBold, serifItalic, script } = fonts;

  // Exact center axis of the printable text area (x = 35 to x = 360)
  const columnLeft = 35;
  const columnRight = 360;
  const centerX = (columnLeft + columnRight) / 2; // = 197.5 pt

  const drawInColumn = (text, y, font, size, color = colors.text) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: centerX - w / 2, y, size, font, color });
  };

  // Top Ornamental Flourish
  drawOrnamentalDivider(page, 785, { left: centerX - 65, right: centerX + 65, flourishImage });

  // Host Intro & Host Names
  drawInColumn(event.hostFamilyIntro ?? "We The Family Of", 755, serifRegular, 13);
  drawInColumn(event.hostNames ?? "Dr. William Samoei Ruto", 725, serifBold, 18.5);
  drawInColumn("&", 702, serifRegular, 14.5);
  drawInColumn(event.hostNames2 ?? "Mrs. Rachel Chebet Ruto", 680, serifBold, 18.5);

  // Ornamental Flourish
  drawOrnamentalDivider(page, 650, { left: centerX - 65, right: centerX + 65, flourishImage });

  // Warmly Invite & Guest Name
  drawInColumn("warmly invite", 620, serifItalic, 14);

  const guestName = (guest?.name || "Jane Doe").trim();
  drawInColumn(guestName, 570, serifBold, 23);

  // Centered Horizontal Rule under guest name
  page.drawLine({
    start: { x: centerX - 130, y: 550 },
    end: { x: centerX + 130, y: 550 },
    thickness: 0.8,
    color: colors.gold,
  });

  // Event Title Stack
  drawInColumn("to the", 524, serifRegular, 13);
  drawInColumn(event.eventTitle ?? "Koito ak Chaik", 465, script, 44, colors.text);

  const subtitle = event.eventSubtitle || "(ENGAGEMENT AND FAREWELL)";
  drawInColumn(subtitle, 436, serifBold, 10, colors.darkGold);

  drawInColumn("of their daughter", 405, serifRegular, 13);
  drawInColumn(event.honoreeName ?? "Charlene Chelagat Ruto", 375, serifBold, 18.5);

  // Ornamental Flourish
  drawOrnamentalDivider(page, 345, { left: centerX - 65, right: centerX + 65, flourishImage });

  // Date / Venue / Time Block (Group centered around centerX = 197.5)
  const blockLeft = 96;

  let iconY = 300;
  drawCalendarIcon(page, blockLeft, iconY - 3, 14);
  page.drawText(event.date ?? "8TH AUGUST 2026", {
    x: blockLeft + 23,
    y: iconY,
    size: 10.5,
    font: serifBold,
    color: colors.text,
  });

  iconY -= 32;
  drawPinIcon(page, blockLeft, iconY - 3, 14);
  const venueLines = event.venueLines ?? [
    "INTONA HERITAGE FARM (INTONA RANCH),",
    "KILGORIS TOWN, NASERIAN VILLAGE",
    "NAROK COUNTY, KENYA",
  ];
  venueLines.forEach((line, i) => {
    page.drawText(line, {
      x: blockLeft + 23,
      y: iconY - i * 13,
      size: 9,
      font: serifBold,
      color: colors.text,
    });
  });

  iconY -= 13 * venueLines.length + 12;
  drawClockIcon(page, blockLeft, iconY - 3, 14);
  page.drawText(event.time ?? "10.00 A.M", {
    x: blockLeft + 23,
    y: iconY,
    size: 10.5,
    font: serifBold,
    color: colors.text,
  });

  // Scripture Quote at Bottom (Centered at centerX)
  if (event.scripture) {
    drawInColumn(
      event.scripture.quote ?? "For He will command His angels concerning you",
      138,
      serifItalic,
      10
    );
    if (event.scripture.quoteLine2) {
      drawInColumn(event.scripture.quoteLine2, 124, serifItalic, 10);
    }
    drawInColumn(
      event.scripture.reference ?? "Psalms 91:11 (NIV)",
      108,
      serifBold,
      10.5
    );
  }

  return page;
}
