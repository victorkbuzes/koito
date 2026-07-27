import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { PAGE_WIDTH, PAGE_HEIGHT, colors } from "./styles.js";
import { drawCenteredText, drawPageFrame, drawCalendarIcon, drawPinIcon, drawClockIcon } from "./helpers.js";

/**
 * Page 1 background: the source design has a photographic green silk
 * curtain with a metal clasp running down the right edge. That is a
 * raster/photographic asset, not something vector shapes can reproduce
 * faithfully — it must come from an image.
 *
 * Preferred path: supply a full-bleed background PDF page at
 *   public/ticket-template.pdf   (page 1 = the curtain artwork, no text)
 * We copy that page in as-is and draw the dynamic text on top, which is
 * what the original pdf-generator.js already did and is the most
 * reliable route to pixel fidelity.
 *
 * Fallback: if that template is missing, we draw a plain vector
 * cream/gold-frame page so the document still generates, clearly
 * lower-fidelity than the photographic original.
 */
export async function renderPage1(pdfDoc, fonts, event, guest) {
  const templatePath = path.join(process.cwd(), "public", "ticket-template.pdf");
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

  const { serifRegular, serifBold, serifItalic, script } = fonts;
  // Text column is narrower than the full page width because the real
  // artwork's curtain occupies the right ~35% of the page.
  const textColumnWidth = 470;
  const centerX = (textColumnWidth) / 2 + 20;
  const drawInColumn = (text, y, font, size, color = colors.text) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: centerX - w / 2, y, size, font, color });
  };

  drawInColumn(event.hostFamilyIntro ?? "We The Family Of", 760, serifRegular, 14);
  drawInColumn(event.hostNames ?? "{{hostNames}}", 725, serifBold, 20);
  drawInColumn("warmly invite", 650, serifItalic, 15);

  const guestName = (guest?.name || "{{guestName}}").toUpperCase();
  drawInColumn(guestName, 570, serifBold, 24);

  drawInColumn("to the", 500, serifRegular, 13);
  drawInColumn(event.eventTitle ?? "{{eventTitle}}", 440, script, 42, colors.text);
  if (event.eventSubtitle) {
    drawInColumn(event.eventSubtitle, 405, serifBold, 11, colors.darkGold ?? colors.gold);
  }
  drawInColumn("of their daughter", 375, serifRegular, 13);
  drawInColumn(event.honoreeName ?? "{{honoreeName}}", 345, serifBold, 20);

  // Date / venue / time block with small icons, left-aligned within the column.
  const blockLeft = 60;
  let iconY = 300;
  drawCalendarIcon(page, blockLeft, iconY - 4, 14);
  page.drawText(event.date ?? "{{eventDate}}", { x: blockLeft + 24, y: iconY, size: 12, font: serifBold, color: colors.text });

  iconY -= 30;
  drawPinIcon(page, blockLeft, iconY - 4, 14);
  const venueLines = event.venueLines ?? ["{{venueLine1}}", "{{venueLine2}}", "{{venueLine3}}"];
  venueLines.forEach((line, i) => {
    page.drawText(line, { x: blockLeft + 24, y: iconY - i * 14, size: 10.5, font: serifBold, color: colors.text });
  });

  iconY -= 14 * venueLines.length + 16;
  drawClockIcon(page, blockLeft, iconY - 4, 14);
  page.drawText(event.time ?? "{{eventTime}}", { x: blockLeft + 24, y: iconY, size: 12, font: serifBold, color: colors.text });

  if (event.scripture) {
    drawInColumn(event.scripture.quote ?? "{{scriptureQuote}}", 140, serifItalic, 11.5);
    drawInColumn(event.scripture.reference ?? "{{scriptureReference}}", 122, serifItalic, 11.5);
  }

  return page;
}
