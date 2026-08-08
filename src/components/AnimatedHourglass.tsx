import React, { useId } from "react";
import "./AnimatedHourglass.css";

interface AnimatedHourglassProps {
  size?: number;
  sandColor?: string;
  frameColor?: string;
  className?: string;
}

export const AnimatedHourglass: React.FC<AnimatedHourglassProps> = ({
  size = 104,
  sandColor = "var(--primary)",
  frameColor = "#ffffff",
  className = "",
}) => {
  const id = useId().replace(/:/g, "");
  const topChamberId = `hourglass-top-${id}`;
  const bottomChamberId = `hourglass-bottom-${id}`;
  const titleId = `hourglass-title-${id}`;
  const descriptionId = `hourglass-description-${id}`;

  return (
    <svg
      className={`animated-hourglass ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 104 104"
      fill="none"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
    >
      <title id={titleId}>Loading stream</title>
      <desc id={descriptionId}>
        Sand drains into the lower chamber before the hourglass turns over.
      </desc>
      <defs>
        <clipPath id={topChamberId}>
          <path d="M30 22h44c-1 11-12 19-20 27h-4c-8-8-19-16-20-27Z" />
        </clipPath>
        <clipPath id={bottomChamberId}>
          <path d="M50 55h4c8 8 19 16 20 27H30c1-11 12-19 20-27Z" />
        </clipPath>
      </defs>

      <g className="animated-hourglass__turn">
        <g fill={sandColor} color={sandColor}>
          <g clipPath={`url(#${topChamberId})`}>
            <rect
              className="animated-hourglass__top"
              x="29"
              y="21"
              width="46"
              height="29"
              rx="1"
            />
          </g>
          <g clipPath={`url(#${bottomChamberId})`}>
            <rect
              className="animated-hourglass__bottom"
              x="29"
              y="54"
              width="46"
              height="29"
              rx="1"
            />
          </g>
        </g>
        <g
          fill="none"
          stroke={frameColor}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 17h60M22 87h60" strokeWidth="5" />
          <path
            d="M27 21c0 14 12 21 20 29l2 2-2 2c-8 8-20 15-20 29M77 21c0 14-12 21-20 29l-2 2 2 2c8 8 20 15 20 29"
            strokeWidth="3.2"
          />
        </g>
      </g>

      {/* The stream stays in screen space. Rotating it with the chambers
          makes the falling grains appear to travel upward after a flip. */}
      <g fill={sandColor} color={sandColor}>
        <path
          className="animated-hourglass__stream animated-hourglass__stream--fixed"
          d="M52 48.5v15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="1.5 3"
        />
        <circle
          className="animated-hourglass__grain"
          cx="52"
          cy="52"
          r="1.7"
        />
      </g>
    </svg>
  );
};
