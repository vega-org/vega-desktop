import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

type DetailPalette = Record<string, string>;
type DetailPaletteStyle = CSSProperties & Record<`--${string}`, string>;

const paletteCache = new Map<string, Promise<DetailPalette | null>>();
const resolvedPaletteCache = new Map<string, DetailPalette | null>();
const STORED_PALETTE_CACHE_KEY = "vegaArtworkPaletteCache";
const MAX_STORED_PALETTES = 100;

type StoredPalette = { accent: string; usedAt: number };

const readStoredPalettes = (): Record<string, StoredPalette> => {
  try {
    const value = localStorage.getItem(STORED_PALETTE_CACHE_KEY);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

const storedPalettes = readStoredPalettes();

const persistAccent = (url: string, accent: string) => {
  try {
    storedPalettes[url] = { accent, usedAt: Date.now() };
    const entries = Object.entries(storedPalettes);
    if (entries.length > MAX_STORED_PALETTES) {
      entries
        .sort(([, left], [, right]) => right.usedAt - left.usedAt)
        .slice(MAX_STORED_PALETTES)
        .forEach(([key]) => delete storedPalettes[key]);
    }
    localStorage.setItem(STORED_PALETTE_CACHE_KEY, JSON.stringify(storedPalettes));
  } catch {
    // Palette persistence is only an optimization.
  }
};

const toHex = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

const rgbToHex = (red: number, green: number, blue: number) =>
  `#${toHex(red)}${toHex(green)}${toHex(blue)}`.toUpperCase();

const mixHex = (color: string, target: string, amount: number) => {
  const parse = (value: string) =>
    [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  const source = parse(color);
  const destination = parse(target);
  return rgbToHex(
    source[0] + (destination[0] - source[0]) * amount,
    source[1] + (destination[1] - source[1]) * amount,
    source[2] + (destination[2] - source[2]) * amount,
  );
};

const decodeImage = async (source: string, objectUrl?: string) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Artwork could not be decoded"));
      image.src = source;
    });
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return {
    image,
    release: () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  };
};

const loadBrowserImage = (url: string) => decodeImage(url);

const loadTauriImage = async (url: string) => {
  const response = await tauriFetch(url);
  if (!response.ok) throw new Error(`Artwork request failed: ${response.status}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  return decodeImage(objectUrl, objectUrl);
};

const selectVibrantAccent = (pixels: Uint8ClampedArray) => {
  const buckets = new Map<string, { red: number; green: number; blue: number; score: number }>();

  for (let index = 0; index < pixels.length; index += 16) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (pixels[index + 3] < 180) continue;

    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max ? (max - min) / max : 0;
    const brightness = max / 255;
    if (brightness < 0.16 || brightness > 0.94 || saturation < 0.12) continue;

    const key = `${Math.round(red / 28)},${Math.round(green / 28)},${Math.round(blue / 28)}`;
    const weight = 1 + saturation * 4 + (1 - Math.abs(brightness - 0.62)) * 2;
    const bucket = buckets.get(key) || { red: 0, green: 0, blue: 0, score: 0 };
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
    bucket.score += weight;
    buckets.set(key, bucket);
  }

  const selected = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
  return selected
    ? rgbToHex(selected.red / selected.score, selected.green / selected.score, selected.blue / selected.score)
    : undefined;
};

const buildMobileDetailPalette = (accent: string): DetailPalette => {
  const paleAccent = mixHex(accent, "#FFFFFF", 0.72);
  const tintedSurface = (base: string, amount: number) => mixHex(base, accent, amount);
  return {
    "--artwork-accent": accent,
    "--primary": paleAccent,
    "--on-primary": "#171717",
    "--primary-container": paleAccent,
    "--on-primary-container": "#171717",
    "--secondary": mixHex(accent, "#FFFFFF", 0.66),
    "--on-secondary": "#171717",
    "--secondary-container": mixHex(accent, "#FFFFFF", 0.78),
    "--on-secondary-container": "#171717",
    "--tertiary": mixHex(accent, "#FFFFFF", 0.62),
    "--on-tertiary": "#171717",
    "--tertiary-container": mixHex(accent, "#FFFFFF", 0.8),
    "--on-tertiary-container": "#171717",
    "--surface-tint": paleAccent,
    "--background": mixHex(accent, "#000000", 0.96),
    "--surface": tintedSurface("#171717", 0.08),
    "--surface-dim": tintedSurface("#141414", 0.06),
    "--surface-container-lowest": tintedSurface("#101010", 0.05),
    "--surface-container-low": tintedSurface("#1B1B1B", 0.1),
    "--surface-container": tintedSurface("#222222", 0.12),
    "--surface-container-high": tintedSurface("#2A2A2A", 0.14),
    "--surface-container-highest": tintedSurface("#343434", 0.16),
    "--surface-bright": tintedSurface("#3D3D3D", 0.18),
    "--surface-variant": tintedSurface("#303030", 0.14),
    "--outline": mixHex(accent, "#FFFFFF", 0.48),
    "--outline-variant": tintedSurface("#5A5A5A", 0.18),
  };
};

const extractAccent = (image: HTMLImageElement) => {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, 64, 64);
  return selectVibrantAccent(context.getImageData(0, 0, 64, 64).data);
};

const getKnownPalette = (url: string) => {
  if (resolvedPaletteCache.has(url)) {
    return { known: true, palette: resolvedPaletteCache.get(url) ?? null };
  }
  const storedAccent = storedPalettes[url]?.accent;
  if (storedAccent) {
    const palette = buildMobileDetailPalette(storedAccent);
    resolvedPaletteCache.set(url, palette);
    return { known: true, palette };
  }
  return { known: false, palette: null };
};

const extractPalette = (url: string) => {
  const known = getKnownPalette(url);
  if (known.known) return Promise.resolve(known.palette);

  const cached = paletteCache.get(url);
  if (cached) return cached;

  const request = (async () => {
    const loaders = [() => loadBrowserImage(url), () => loadTauriImage(url)];
    for (const load of loaders) {
      try {
        const { image, release } = await load();
        try {
          const accent = extractAccent(image);
          if (accent) {
            persistAccent(url, accent);
            return buildMobileDetailPalette(accent);
          }
        } finally {
          release();
        }
      } catch {
        // Cross-origin artwork falls back to the Tauri HTTP client.
      }
    }
    return null;
  })().then((palette) => {
    resolvedPaletteCache.set(url, palette);
    return palette;
  });

  paletteCache.set(url, request);
  return request;
};

export const prefetchArtworkPalette = (imageUrl?: string | null) =>
  imageUrl ? extractPalette(imageUrl) : Promise.resolve(null);

export function useArtworkPaletteReady(imageUrl?: string | null) {
  const [ready, setReady] = useState(() =>
    !imageUrl || getKnownPalette(imageUrl).known,
  );

  useEffect(() => {
    let active = true;
    if (!imageUrl) {
      setReady(true);
      return () => { active = false; };
    }

    const known = getKnownPalette(imageUrl);
    setReady(known.known);
    if (!known.known) void extractPalette(imageUrl).then(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, [imageUrl]);

  return ready;
}

export function useArtworkPalette(imageUrl?: string | null) {
  const [palette, setPalette] = useState<DetailPalette | null>(() =>
    imageUrl ? getKnownPalette(imageUrl).palette : null,
  );

  useEffect(() => {
    let active = true;
    if (!imageUrl) {
      setPalette(null);
      return () => { active = false; };
    }

    const known = getKnownPalette(imageUrl);
    setPalette(known.palette);
    if (!known.known) void extractPalette(imageUrl).then((nextPalette) => {
      if (active) setPalette(nextPalette);
    });

    return () => {
      active = false;
    };
  }, [imageUrl]);

  return useMemo<DetailPaletteStyle>(() => (palette || {}) as DetailPaletteStyle, [palette]);
}
