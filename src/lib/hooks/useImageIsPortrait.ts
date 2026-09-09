import { useEffect, useState } from "react";

export function useImageIsPortrait(url?: string): boolean {
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    if (!url) {
      setIsPortrait(false);
      return;
    }
    let active = true;
    const img = new Image();
    img.src = url;
    if (img.complete && img.naturalWidth && img.naturalHeight) {
      setIsPortrait(img.naturalHeight > img.naturalWidth);
    } else {
      img.onload = () => {
        if (active && img.naturalWidth && img.naturalHeight) {
          setIsPortrait(img.naturalHeight > img.naturalWidth);
        }
      };
      img.onerror = () => {
        if (active) setIsPortrait(false);
      };
    }
    return () => {
      active = false;
    };
  }, [url]);

  return isPortrait;
}
