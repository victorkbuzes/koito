import QRCode from "qrcode";
import { rgb } from "pdf-lib";
import { PAGE_WIDTH, PAGE_HEIGHT, colors, frame } from "./styles.js";

export function drawCenteredText(page, text, y, font, size, color = colors.text) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font, color });
  return width;
}

/** Wraps text to fit maxWidth, centering each resulting line. Returns the y after the last line. */
export function drawWrappedCenteredText(page, text, startY, font, size, color, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let y = startY;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      drawCenteredText(page, line, y, font, size, color);
      y -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    drawCenteredText(page, line, y, font, size, color);
    y -= lineHeight;
  }
  return y;
}

/** Draws the double-rule border and four corner brackets shared by both pages. */
export function drawPageFrame(page) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: page.getHeight(), color: colors.cream });
  page.drawRectangle({
    x: frame.outer.x, y: frame.outer.y, width: frame.outer.width, height: frame.outer.height,
    borderColor: colors.gold, borderWidth: frame.outer.borderWidth,
  });
  page.drawRectangle({
    x: frame.inner.x, y: frame.inner.y, width: frame.inner.width, height: frame.inner.height,
    borderColor: colors.gold, borderWidth: frame.inner.borderWidth,
  });

  const s = frame.cornerSize;
  const h = page.getHeight();
  const corners = [
    { x: frame.outer.x, y: h - frame.outer.y - s },
    { x: PAGE_WIDTH - frame.outer.x - s, y: h - frame.outer.y - s },
    { x: frame.outer.x, y: frame.outer.y },
    { x: PAGE_WIDTH - frame.outer.x - s, y: frame.outer.y },
  ];
  corners.forEach((c) => {
    page.drawRectangle({ x: c.x, y: c.y, width: s, height: s, borderColor: colors.gold, borderWidth: frame.cornerBorderWidth });
  });
}

/**
 * Draws an Ornamental Flourish divider.
 * If flourishImage is provided, it draws the flourish image.
 * Otherwise, it draws an ornate scroll divider matching Image 2.
 */
export function drawOrnamentalDivider(
  page,
  y,
  { left = 135, right = 265, flourishImage = null, width = 130, height = 16 } = {}
) {
  const midX = (left + right) / 2;

  if (flourishImage) {
    page.drawImage(flourishImage, {
      x: midX - width / 2,
      y: y - height / 2,
      width,
      height,
    });
  } else {
    // Ornate scroll divider matching Image 2 design
    page.drawLine({ start: { x: left, y }, end: { x: midX - 16, y }, thickness: 0.8, color: colors.gold });
    page.drawLine({ start: { x: midX + 16, y }, end: { x: right, y }, thickness: 0.8, color: colors.gold });
    page.drawEllipse({ x: left, y, xScale: 1.5, yScale: 1.5, color: colors.gold });
    page.drawEllipse({ x: right, y, xScale: 1.5, yScale: 1.5, color: colors.gold });

    // Center scroll diamond ornament
    const d = 4;
    page.drawLine({ start: { x: midX - d, y }, end: { x: midX, y: y + d }, thickness: 0.9, color: colors.gold });
    page.drawLine({ start: { x: midX, y: y + d }, end: { x: midX + d, y }, thickness: 0.9, color: colors.gold });
    page.drawLine({ start: { x: midX + d, y }, end: { x: midX, y: y - d }, thickness: 0.9, color: colors.gold });
    page.drawLine({ start: { x: midX, y: y - d }, end: { x: midX - d, y }, thickness: 0.9, color: colors.gold });

    // Flanking scroll dots
    page.drawEllipse({ x: midX - 9, y, xScale: 1.2, yScale: 1.2, color: colors.gold });
    page.drawEllipse({ x: midX + 9, y, xScale: 1.2, yScale: 1.2, color: colors.gold });
  }
}

/** Vector calendar icon matching design */
export function drawCalendarIcon(page, x, y, size = 15) {
  page.drawRectangle({ x, y, width: size, height: size * 0.85, borderColor: colors.gold, borderWidth: 1.1 });
  page.drawLine({ start: { x, y: y + size * 0.6 }, end: { x: x + size, y: y + size * 0.6 }, thickness: 0.9, color: colors.gold });
  page.drawLine({ start: { x: x + size * 0.25, y: y + size * 0.85 }, end: { x: x + size * 0.25, y: y + size * 1.05 }, thickness: 1.1, color: colors.gold });
  page.drawLine({ start: { x: x + size * 0.75, y: y + size * 0.85 }, end: { x: x + size * 0.75, y: y + size * 1.05 }, thickness: 1.1, color: colors.gold });
}

/** Vector map-pin icon matching design */
export function drawPinIcon(page, x, y, size = 15) {
  const cx = x + size / 2;
  page.drawEllipse({ x: cx, y: y + size * 0.65, xScale: size * 0.35, yScale: size * 0.35, borderColor: colors.gold, borderWidth: 1.1, color: undefined });
  page.drawLine({ start: { x: cx - size * 0.3, y: y + size * 0.55 }, end: { x: cx, y: y - size * 0.1 }, thickness: 1.1, color: colors.gold });
  page.drawLine({ start: { x: cx + size * 0.3, y: y + size * 0.55 }, end: { x: cx, y: y - size * 0.1 }, thickness: 1.1, color: colors.gold });
}

/** Vector clock icon matching design */
export function drawClockIcon(page, x, y, size = 15) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;
  page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, borderColor: colors.gold, borderWidth: 1.1, color: undefined });
  page.drawLine({ start: { x: cx, y: cy }, end: { x: cx, y: cy + r * 0.55 }, thickness: 1.1, color: colors.gold });
  page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + r * 0.4, y: cy }, thickness: 1.1, color: colors.gold });
}

/** Vector dress code mannequin icon matching design */
export function drawDressCodeIcon(page, x, y, size = 20) {
  const cx = x + size / 2;
  page.drawEllipse({ x: cx, y: y + size * 0.85, xScale: 3.5, yScale: 3.5, borderColor: colors.gold, borderWidth: 1.2, color: undefined });
  page.drawLine({ start: { x: cx, y: y + size * 0.65 }, end: { x: cx, y: y + size * 0.15 }, thickness: 1.2, color: colors.gold });
  page.drawLine({ start: { x: cx - size * 0.3, y: y + size * 0.15 }, end: { x: cx + size * 0.3, y: y + size * 0.15 }, thickness: 1.2, color: colors.gold });
}

/** Placeholder draped green curtain asset for Page 1 if photographic asset is absent */
export function drawCurtainPlaceholder(page) {
  const deepGreen = rgb(0.04, 0.28, 0.14);
  const goldBrooch = rgb(0.78, 0.62, 0.28);
  const startX = 360;
  
  page.drawRectangle({
    x: startX,
    y: 0,
    width: PAGE_WIDTH - startX,
    height: PAGE_HEIGHT,
    color: deepGreen,
  });

  // Draped gold border line along left edge of curtain
  page.drawLine({
    start: { x: startX, y: 0 },
    end: { x: startX, y: PAGE_HEIGHT },
    thickness: 2,
    color: goldBrooch,
  });

  // Gold Brooch Clasp at middle height
  const broochY = 460;
  page.drawEllipse({ x: startX, y: broochY, xScale: 14, yScale: 14, color: goldBrooch });
  page.drawEllipse({ x: startX, y: broochY, xScale: 8, yScale: 8, color: deepGreen });
}

/** Generates a QR PNG for the given value and embeds it, returning the pdf-lib image. */
export async function embedQrCode(pdfDoc, value) {
  const dataUrl = await QRCode.toDataURL(value, {
    margin: 1,
    width: 400,
    color: { dark: "#2C2416", light: "#FFFFFF" },
  });
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  return pdfDoc.embedPng(bytes);
}
