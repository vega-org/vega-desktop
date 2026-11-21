import { useEffect, useState } from "react";

export interface HeroImageLayout {
  useCardHero: boolean;
  containPoster: boolean;
  posterAspectRatio: "portrait" | "square" | "landscape";
}

const DEFAULT_LAYOUT: HeroImageLayout = {
  useCardHero: false,
  containPoster: false,
  posterAspectRatio: "portrait",
};

function classifyHeroImage(width: number, height: number): HeroImageLayout {
  if (!width || !height) return DEFAULT_LAYOUT;
  const ratio = width / height;
  const isPortrait = height > width * 1.05;
  const isSquare = !isPortrait && ratio <= 1.2;
  const isSmall = width < 640 || height < 360;

  if (!isPortrait && !isSquare && !isSmall) {
    return DEFAULT_LAYOUT;
  }

  return {
    useCardHero: true,
    containPoster: !isPortrait || isSmall,
    posterAspectRatio: isPortrait ? "portrait" : isSquare ? "square" : "landscape",
  };
}

export function useHeroImageLayout(url?: string): HeroImageLayout {
  const [layout, setLayout] = useState<HeroImageLayout>(DEFAULT_LAYOUT);

  useEffect(() => {
    if (!url) {
      setLayout(DEFAULT_LAYOUT);
      return;
    }
    let active = true;
    const img = new Image();
    img.src = url;
    if (img.complete && img.naturalWidth && img.naturalHeight) {
      setLayout(classifyHeroImage(img.naturalWidth, img.naturalHeight));
    } else {
      img.onload = () => {
        if (active && img.naturalWidth && img.naturalHeight) {
          setLayout(classifyHeroImage(img.naturalWidth, img.naturalHeight));
        }
      };
      img.onerror = () => {
        if (active) setLayout(DEFAULT_LAYOUT);
      };
    }
    return () => {
      active = false;
    };
  }, [url]);

  return layout;
}

export function useImageIsPortrait(url?: string): boolean {
  return useHeroImageLayout(url).useCardHero;
}
