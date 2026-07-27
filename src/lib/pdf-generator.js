import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";

export async function generateSingleInvitationDoc(guestName, pinCode) {
  const pdfDoc = await PDFDocument.create();

  const fontRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const fontSans = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const goldColor = rgb(0.72, 0.58, 0.25);
  const darkGold = rgb(0.60, 0.46, 0.15);
  const textColor = rgb(0.12, 0.10, 0.08);
  const creamBg = rgb(0.97, 0.95, 0.91);

  const drawCenteredText = (page, text, y, font, size, color) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (595.28 - w) / 2, y, size, font, color });
  };

  // ════════════ PAGE 1: Load Page 1 Artwork & Overlay Guest Name ════════════
  const templatePath = path.join(process.cwd(), "public", "ticket-template.pdf");
  let page1Added = false;

  if (fs.existsSync(templatePath)) {
    try {
      const templateBytes = fs.readFileSync(templatePath);
      const templateDoc = await PDFDocument.load(templateBytes);
      if (templateDoc.getPageCount() >= 1) {
        const [p1] = await pdfDoc.copyPages(templateDoc, [0]);
        pdfDoc.addPage(p1);
        page1Added = true;
      }
    } catch (e) {
      console.warn("Could not load public/ticket-template.pdf for Page 1:", e);
    }
  }

  const formattedName = (guestName || "HONORED GUEST").toUpperCase();

  if (page1Added) {
    const page1 = pdfDoc.getPages()[0];
    const nameSize = 22;
    const nameWidth = fontBold.widthOfTextAtSize(formattedName, nameSize);
    const nameX = (470 - nameWidth) / 2;
    page1.drawText(formattedName, {
      x: nameX,
      y: 508,
      size: nameSize,
      font: fontBold,
      color: textColor,
    });
  } else {
    // Vector fallback for Page 1
    const page1 = pdfDoc.addPage([595.28, 841.89]);
    page1.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: creamBg });
    page1.drawRectangle({ x: 20, y: 20, width: 555.28, height: 801.89, borderColor: goldColor, borderWidth: 2 });
    page1.drawRectangle({ x: 28, y: 28, width: 539.28, height: 785.89, borderColor: goldColor, borderWidth: 1 });
    drawCenteredText(page1, "We The Family Of", 760, fontRoman, 14, textColor);
    drawCenteredText(page1, "Dr. William Samoei Ruto & Mrs. Rachel Chebet Ruto", 725, fontBold, 20, textColor);
    drawCenteredText(page1, "warmly invite", 650, fontItalic, 15, textColor);
    drawCenteredText(page1, formattedName, 570, fontBold, 24, textColor);
    drawCenteredText(page1, "to the Koito ak Chaik", 500, fontBold, 22, textColor);
    drawCenteredText(page1, "Charlene Chelagat Ruto", 440, fontBold, 22, textColor);
  }

  // ════════════ PAGE 2: Pixel-Perfect Page 2 Matching New Template ════════════
  const page2 = pdfDoc.addPage([595.28, 841.89]);

  // Background & Borders
  page2.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: creamBg });
  page2.drawRectangle({ x: 20, y: 20, width: 555.28, height: 801.89, borderColor: goldColor, borderWidth: 2 });
  page2.drawRectangle({ x: 28, y: 28, width: 539.28, height: 785.89, borderColor: goldColor, borderWidth: 1 });

  const corners = [
    { x: 20, y: 821.89 - 25, w: 25, h: 25 },
    { x: 575.28 - 25, y: 821.89 - 25, w: 25, h: 25 },
    { x: 20, y: 20, w: 25, h: 25 },
    { x: 575.28 - 25, y: 20, w: 25, h: 25 },
  ];
  corners.forEach(c => {
    page2.drawRectangle({ x: c.x, y: c.y, width: c.w, height: c.h, borderColor: goldColor, borderWidth: 1.5 });
  });

  // Top Text
  drawCenteredText(page2, "We look forward to celebrating with you!", 760, fontRoman, 14, textColor);
  drawCenteredText(page2, "Please visit www.charlene-ruto.com", 738, fontBold, 13, darkGold);
  drawCenteredText(page2, "to RSVP and find details including the Venue directions.", 718, fontRoman, 12, textColor);
  drawCenteredText(page2, "Please use the 4-digit Guest PIN below to access the site.", 692, fontRoman, 12, textColor);

  // Guest PIN Box
  const boxX = 160, boxY = 625, boxW = 275, boxH = 44;
  page2.drawRectangle({
    x: boxX, y: boxY, width: boxW, height: boxH,
    borderColor: goldColor, borderWidth: 1.5, color: rgb(0.99, 0.98, 0.95),
  });
  page2.drawText("GUEST PIN:", { x: boxX + 25, y: boxY + 14, size: 15, font: fontBold, color: textColor });
  page2.drawText(pinCode || "4050", { x: boxX + 175, y: boxY + 13, size: 19, font: fontBold, color: textColor });

  // Divider
  page2.drawLine({ start: { x: 180, y: 590 }, end: { x: 415, y: 590 }, thickness: 1, color: goldColor });

  // Dress Code
  drawCenteredText(page2, "DRESS CODE:", 535, fontBold, 15, textColor);
  drawCenteredText(page2, "Warm, Natural, Timeless", 512, fontItalic, 14, textColor);

  const swatches = [
    { name: "MOCHA", color: rgb(0.52, 0.46, 0.40) },
    { name: "CHOCOLATE", color: rgb(0.35, 0.24, 0.11) },
    { name: "CARAMEL", color: rgb(0.78, 0.52, 0.21) },
    { name: "GOLD", color: rgb(0.77, 0.60, 0.32) },
  ];
  const startX = 140, swatchY = 430, swW = 60, swH = 60, gap = 24;
  swatches.forEach((s, idx) => {
    const sx = startX + idx * (swW + gap);
    page2.drawRectangle({ x: sx, y: swatchY, width: swW, height: swH, color: s.color });
    const txtW = fontSans.widthOfTextAtSize(s.name, 9);
    page2.drawText(s.name, { x: sx + (swW - txtW) / 2, y: swatchY - 18, size: 9, font: fontSans, color: textColor });
  });

  // Divider
  page2.drawLine({ start: { x: 180, y: 380 }, end: { x: 415, y: 380 }, thickness: 1, color: goldColor });

  // QR Code & Text Section
  const qrDataUrl = await QRCode.toDataURL(pinCode || "4050", {
    margin: 1,
    width: 400,
    color: { dark: "#2C2416", light: "#FFFFFF" },
  });
  const qrImageBytes = Buffer.from(qrDataUrl.split(",")[1], "base64");
  const qrImage = await pdfDoc.embedPng(qrImageBytes);

  page2.drawText("Please present this", { x: 130, y: 310, size: 13, font: fontRoman, color: textColor });
  page2.drawText("QR code at the", { x: 130, y: 292, size: 13, font: fontRoman, color: textColor });
  page2.drawText("entrance for a quick", { x: 130, y: 274, size: 13, font: fontRoman, color: textColor });
  page2.drawText("scan and entry.", { x: 130, y: 256, size: 13, font: fontRoman, color: textColor });

  page2.drawImage(qrImage, { x: 315, y: 200, width: 140, height: 140 });

  // Divider
  page2.drawLine({ start: { x: 180, y: 175 }, end: { x: 415, y: 175 }, thickness: 1, color: goldColor });

  // RSVP Contacts
  drawCenteredText(page2, "RSVP", 145, fontBold, 14, darkGold);
  drawCenteredText(page2, "Contacts", 128, fontItalic, 13, textColor);
  drawCenteredText(page2, "Deborah - +254 714 591 747", 104, fontRoman, 13, textColor);
  drawCenteredText(page2, "Maureen - +254 719 701 335", 86, fontRoman, 13, textColor);

  return pdfDoc;
}
