type Rgb = { r: number; g: number; b: number };

const FALLBACK_ACCENT = "#ffb2be";

function parseHex(value: string): Rgb {
  const normalized = value.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;
  const match = /^([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(expanded);

  if (!match) {
    return parseHex(FALLBACK_ACCENT);
  }

  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: color.r + (target.r - color.r) * amount,
    g: color.g + (target.g - color.g) * amount,
    b: color.b + (target.b - color.b) * amount,
  };
}

function contrastText(color: Rgb): string {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linearize(color.r) +
    0.7152 * linearize(color.g) +
    0.0722 * linearize(color.b);
  return luminance > 0.42 ? "#171217" : "#ffffff";
}

export function applyThemeTokens(
  accent: string,
  backgroundTheme: string,
): void {
  const root = document.documentElement;
  const primary = parseHex(accent);
  const isLight = backgroundTheme === "white";
  const container = mix(
    primary,
    isLight ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 },
    isLight ? 0.76 : 0.64,
  );

  root.setAttribute("data-theme", backgroundTheme);
  root.style.setProperty("--primary", toHex(primary));
  root.style.setProperty(
    "--primary-rgb",
    `${primary.r}, ${primary.g}, ${primary.b}`,
  );
  root.style.setProperty("--on-primary", contrastText(primary));
  root.style.setProperty("--primary-container", toHex(container));
  root.style.setProperty("--on-primary-container", contrastText(container));
  root.style.setProperty("--focus-ring", toHex(primary));
  root.style.setProperty("--loading-indicator", toHex(primary));
}
