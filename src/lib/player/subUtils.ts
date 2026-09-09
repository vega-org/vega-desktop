import { settingsStorage } from "../storage";

export interface SubtitleStyleConfig {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  outlineSize?: number;
  bottomPadding?: number;
  textColor?: string;
  outlineColor?: string;
  shadowColor?: string;
  shadowSize?: number;
  shadowStyle?: string;
}

export function hexToAssColor(hex?: string, defaultAssAlpha: number = 0): string {
  if (!hex || hex === "transparent" || hex === "none") {
    return "&HFF000000";
  }

  let clean = hex.replace("#", "").trim();

  // If rgba format: rgba(r, g, b, a)
  if (hex.startsWith("rgb")) {
    const match = hex.match(/\d+(\.\d+)?/g);
    if (match && match.length >= 3) {
      const r = Math.min(255, Math.max(0, parseInt(match[0], 10)))
        .toString(16)
        .padStart(2, "0");
      const g = Math.min(255, Math.max(0, parseInt(match[1], 10)))
        .toString(16)
        .padStart(2, "0");
      const b = Math.min(255, Math.max(0, parseInt(match[2], 10)))
        .toString(16)
        .padStart(2, "0");
      let assAlpha = defaultAssAlpha;
      if (match.length >= 4) {
        const aFloat = parseFloat(match[3]);
        const webAlpha = Math.round(Math.min(1, Math.max(0, aFloat)) * 255);
        assAlpha = 255 - webAlpha;
      }
      const aHex = assAlpha.toString(16).padStart(2, "0").toUpperCase();
      return `&H${aHex}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
    }
  }

  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((c) => c + c)
      .join("");
  }

  if (clean.length === 6) {
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    const a = defaultAssAlpha.toString(16).padStart(2, "0").toUpperCase();
    return `&H${a}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
  }

  if (clean.length === 8) {
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    const webAlpha = parseInt(clean.slice(6, 8), 16);
    const assAlpha = (255 - webAlpha).toString(16).padStart(2, "0").toUpperCase();
    return `&H${assAlpha}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
  }

  return "&H00FFFFFF";
}

export function getSubtitleStyleConfig(): Required<SubtitleStyleConfig> {
  let baseFont = "sans-serif";
  let rawSize = 16;
  let fontWeight = 400;
  let outlineSize = 2;
  let rawPadding = 10;
  let textColor = "#FFFFFF";
  let outlineColor = "#000000";
  let shadowColor = "#000000";
  let shadowSize = 2;
  let shadowStyle = "drop";

  try {
    baseFont = settingsStorage.getSubtitleFontFamily() || "sans-serif";
    rawSize = settingsStorage.getSubtitleFontSize() || 16;
    fontWeight = settingsStorage.getSubtitleFontWeight() || 400;
    outlineSize = settingsStorage.getSubtitleOutlineSize() ?? 2;
    rawPadding = settingsStorage.getSubtitleBottomPadding() ?? 10;
    textColor = settingsStorage.getSubtitleTextColor() || "#FFFFFF";
    outlineColor = settingsStorage.getSubtitleOutlineColor() || "#000000";
    shadowColor = settingsStorage.getSubtitleShadowColor() || "#000000";
    shadowSize = settingsStorage.getSubtitleShadowSize() ?? 2;
    shadowStyle = settingsStorage.getSubtitleShadowStyle() || "drop";
  } catch {
    // Fallback if settingsStorage is unavailable
  }

  const fontFamily = baseFont === "sans-serif" ? "Liberation Sans" : baseFont;
  const fontSize = Math.round(Math.max(24, Math.min(220, rawSize * 2.5)));
  const bottomPadding = Math.round(Math.max(0, Math.min(180, rawPadding * 3.5)));

  return {
    fontFamily,
    fontSize,
    fontWeight,
    outlineSize,
    bottomPadding,
    textColor,
    outlineColor,
    shadowColor,
    shadowSize,
    shadowStyle,
  };
}

function parseTimeToSeconds(timeStr: string): number {
  const clean = timeStr.trim().replace(",", ".");
  const parts = clean.split(":");
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  } else if (parts.length === 3) {
    return (
      parseFloat(parts[0]) * 3600 +
      parseFloat(parts[1]) * 60 +
      parseFloat(parts[2])
    );
  }
  return 0;
}

function secondsToAssTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const totalCs = Math.round(seconds * 100);
  const cs = totalCs % 100;
  const s = Math.floor(totalCs / 100) % 60;
  const m = Math.floor(totalCs / 6000) % 60;
  const h = Math.floor(totalCs / 360000);
  const pad = (n: number, w: number = 2) => String(n).padStart(w, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs, 2)}`;
}

export function convertSubToAss(
  subContent: string,
  styleConfig?: SubtitleStyleConfig,
): string {
  if (!subContent || typeof subContent !== "string") return "";
  const trimmed = subContent.trim();

  // If already ASS/SSA script, return directly
  if (trimmed.includes("[Script Info]") && trimmed.includes("[Events]")) {
    return subContent;
  }

  const cfg = {
    ...getSubtitleStyleConfig(),
    ...styleConfig,
  };

  const isBold = cfg.fontWeight >= 600 ? 1 : 0;
  const hasOutline = cfg.outlineSize > 0 && cfg.outlineColor !== "transparent" && cfg.outlineColor !== "none";
  const hasShadow = cfg.shadowSize > 0 && cfg.shadowStyle !== "none" && cfg.shadowColor !== "transparent" && cfg.shadowColor !== "none";
  const outline = hasOutline ? (cfg.outlineSize * 1.2).toFixed(1) : "0";
  const shadow = hasShadow ? (cfg.shadowSize * 0.9).toFixed(1) : "0";

  const primaryColour = hexToAssColor(cfg.textColor, 0x00);
  const outlineColour = hexToAssColor(cfg.outlineColor, 0x00);
  const shadowColour = hexToAssColor(cfg.shadowColor, 0x80);

  const assHeader = [
    "[Script Info]",
    "Title: Subtitles",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.601",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${cfg.fontFamily},${cfg.fontSize},${primaryColour},&H000000FF,${outlineColour},${shadowColour},${isBold},0,0,0,100,100,0,0,1,${outline},${shadow},2,40,40,${cfg.bottomPadding},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const lines = subContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const dialogues: string[] = [];
  const timeRegex =
    /((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{2,3})/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (
      !line ||
      line.startsWith("WEBVTT") ||
      line.startsWith("NOTE") ||
      line.startsWith("STYLE") ||
      line.startsWith("REGION")
    ) {
      i++;
      continue;
    }

    const match = line.match(timeRegex);
    if (match) {
      const startTime = secondsToAssTime(parseTimeToSeconds(match[1]));
      const endTime = secondsToAssTime(parseTimeToSeconds(match[2]));
      i++;

      const textLines: string[] = [];
      while (i < lines.length) {
        const nextLine = lines[i].trim();
        if (!nextLine) break;
        if (timeRegex.test(nextLine)) {
          break;
        }
        if (
          /^\d+$/.test(nextLine) &&
          i + 1 < lines.length &&
          timeRegex.test(lines[i + 1])
        ) {
          break;
        }
        textLines.push(nextLine);
        i++;
      }

      let text = textLines.join("\\N");
      text = text
        .replace(/<v[^>]*>/gi, "")
        .replace(/<\/v>/gi, "")
        .replace(/<c[^>]*>/gi, "")
        .replace(/<\/c>/gi, "")
        .replace(/<b>/gi, "{\\b1}")
        .replace(/<\/b>/gi, "{\\b0}")
        .replace(/<i>/gi, "{\\i1}")
        .replace(/<\/i>/gi, "{\\i0}")
        .replace(/<u>/gi, "{\\u1}")
        .replace(/<\/u>/gi, "{\\u0}")
        .replace(/<[^>]+>/g, "");

      let effectTag = "";
      if (hasShadow) {
        if (cfg.shadowStyle === "glow") {
          effectTag = `{\\blur${Math.max(1, cfg.shadowSize * 0.8).toFixed(1)}}`;
        } else if (cfg.shadowStyle === "raised") {
          effectTag = `{\\xshad-${(cfg.shadowSize * 0.4).toFixed(1)}\\yshad-${(cfg.shadowSize * 0.4).toFixed(1)}}`;
        } else if (cfg.shadowStyle === "depressed") {
          effectTag = `{\\xshad${(cfg.shadowSize * 0.4).toFixed(1)}\\yshad${(cfg.shadowSize * 0.4).toFixed(1)}}`;
        }
      }

      if (text) {
        dialogues.push(
          `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${effectTag}${text}`,
        );
      }
    } else {
      i++;
    }
  }

  return `${assHeader}\n${dialogues.join("\n")}\n`;
}
