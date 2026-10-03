import React from "react";
import { isLibraryIconKey, LIBRARY_ICONS } from "../../lib/library/libraryIcons";

interface LibraryIconProps {
  icon: string;
  color?: string;
  /** Glyph size in px. The tile is about 1.8x this. */
  size?: number;
  /** Draw the icon on a colored rounded tile. */
  tile?: boolean;
  className?: string;
}

/** Readable text color (dark or white) on a hex background. */
const readableOn = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#17100F" : "#FFFFFF";
};

/** Category icon: an icon key from LIBRARY_ICONS or an emoji. */
export const LibraryIcon: React.FC<LibraryIconProps> = ({
  icon,
  color,
  size = 20,
  tile = false,
  className = "",
}) => {
  const Icon = isLibraryIconKey(icon) ? LIBRARY_ICONS[icon] : null;
  const glyph = Icon ? (
    <Icon size={size} aria-hidden="true" />
  ) : (
    <span
      className="library-icon-emoji"
      style={{ fontSize: size * 0.95, lineHeight: 1 }}
      aria-hidden="true"
    >
      {icon}
    </span>
  );

  if (!tile) {
    return (
      <span
        className={`library-icon ${className}`.trim()}
        style={color ? { color } : undefined}
      >
        {glyph}
      </span>
    );
  }
  const tileSize = Math.round(size * 1.8);
  return (
    <span
      className={`library-icon-tile ${className}`.trim()}
      style={{
        width: tileSize,
        height: tileSize,
        borderRadius: Math.round(tileSize * 0.32),
        ...(color ? { background: color, color: readableOn(color) } : {}),
      }}
    >
      {glyph}
    </span>
  );
};
