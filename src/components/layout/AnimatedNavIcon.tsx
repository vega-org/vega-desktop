import { useEffect, useRef, useState } from "react";

export type AnimatedNavIconName =
  | "home"
  | "search"
  | "watchlist"
  | "download"
  | "extensions"
  | "settings";

type AnimatedNavIconProps = {
  name: AnimatedNavIconName;
  active: boolean;
  size?: number;
};

type IconLayerProps = {
  name: AnimatedNavIconName;
};

const FilledNavIcon = ({ name }: IconLayerProps) => {
  switch (name) {
    case "home":
      return (
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11.025 3.63a1.5 1.5 0 0 1 1.95 0l7.6 6.515a1 1 0 0 1-1.3 1.52L19 11.43V19a2.25 2.25 0 0 1-2.25 2.25h-9.5A2.25 2.25 0 0 1 5 19v-7.57l-.275.235a1 1 0 1 1-1.3-1.52l7.6-6.515ZM9.25 21.25v-5.5A1.75 1.75 0 0 1 11 14h2a1.75 1.75 0 0 1 1.75 1.75v5.5h-5.5Z"
        />
      );
    case "search":
      return (
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M10.75 3a7.75 7.75 0 1 0 4.77 13.86l3.773 3.773a1 1 0 0 0 1.414-1.414l-3.81-3.81A7.75 7.75 0 0 0 10.75 3Zm-5.5 7.75a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0Z"
        />
      );
    case "watchlist":
      return (
        <path
          fill="currentColor"
          d="M8.5 2.75A3.25 3.25 0 0 0 5.25 6v14.25a1.25 1.25 0 0 0 1.828 1.108L12 18.79l4.922 2.568a1.25 1.25 0 0 0 1.828-1.108V6a3.25 3.25 0 0 0-3.25-3.25h-7Z"
        />
      );
    case "download":
      return (
        <>
          <path
            fill="currentColor"
            d="M10.75 3.25a1.25 1.25 0 0 1 2.5 0v8.232l2.116-2.116a1.25 1.25 0 1 1 1.768 1.768l-4.25 4.25a1.25 1.25 0 0 1-1.768 0l-4.25-4.25a1.25 1.25 0 0 1 1.768-1.768l2.116 2.116V3.25Z"
          />
          <path
            fill="currentColor"
            d="M3.25 17.25A2.75 2.75 0 0 1 6 14.5h1.25a1.25 1.25 0 0 1 0 2.5H6a.25.25 0 0 0-.25.25V19c0 .138.112.25.25.25h12a.25.25 0 0 0 .25-.25v-1.75A.25.25 0 0 0 18 17h-1.25a1.25 1.25 0 0 1 0-2.5H18a2.75 2.75 0 0 1 2.75 2.75V19A2.75 2.75 0 0 1 18 21.75H6A2.75 2.75 0 0 1 3.25 19v-1.75Z"
          />
        </>
      );
    case "extensions":
      return (
        <g transform="translate(1 1) scale(0.9167)">
          <path
            fill="currentColor"
            d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11Z"
          />
        </g>
      );
    case "settings":
      return (
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M9.393 2.75A1.25 1.25 0 0 1 10.57 1.9h2.86a1.25 1.25 0 0 1 1.177.83l.474 1.329a1 1 0 0 0 1.31.59l1.277-.554a1.25 1.25 0 0 1 1.58.52l1.43 2.477a1.25 1.25 0 0 1-.4 1.615l-1.104.857a1 1 0 0 0 0 1.578l1.103.856a1.25 1.25 0 0 1 .4 1.616l-1.429 2.476a1.25 1.25 0 0 1-1.58.52l-1.276-.553a1 1 0 0 0-1.311.59l-.474 1.328a1.25 1.25 0 0 1-1.177.83h-2.86a1.25 1.25 0 0 1-1.177-.83l-.474-1.329a1 1 0 0 0-1.31-.59l-1.277.554a1.25 1.25 0 0 1-1.58-.52l-1.43-2.477a1.25 1.25 0 0 1 .4-1.615l1.104-.857a1 1 0 0 0 0-1.578l-1.103-.856a1.25 1.25 0 0 1-.4-1.616l1.429-2.476a1.25 1.25 0 0 1 1.58-.52l1.276.553a1 1 0 0 0 1.311-.59l.474-1.328ZM12 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        />
      );
  }
};

const OutlineNavIcon = ({ name }: IconLayerProps) => {
  switch (name) {
    case "home":
      return (
        <>
          <path
            className="nav-icon-stroke nav-icon-stroke-fast"
            d="M3.75 10.45 10.7 4.5a2 2 0 0 1 2.6 0l6.95 5.95"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-medium"
            d="M5.5 9.25V19A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9.25"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow"
            d="M9.5 20.5v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5"
          />
        </>
      );
    case "search":
      return (
        <>
          <circle
            className="nav-icon-stroke nav-icon-stroke-medium"
            cx="10.75"
            cy="10.75"
            r="6.75"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow nav-icon-part-search"
            d="m15.75 15.75 4.25 4.25"
          />
        </>
      );
    case "watchlist":
      return (
        <>
          <path
            className="nav-icon-stroke nav-icon-stroke-medium"
            d="M6.25 20.5V5.75A2.25 2.25 0 0 1 8.5 3.5h7a2.25 2.25 0 0 1 2.25 2.25V20.5"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow nav-icon-part-bookmark-left"
            d="m6.25 20.5 5.75-3"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow nav-icon-part-bookmark-right"
            d="m12 17.5 5.75 3"
          />
        </>
      );
    case "download":
      return (
        <>
          <path
            className="nav-icon-stroke nav-icon-stroke-medium"
            d="M12 3.5v10.25"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow nav-icon-part-download-right"
            d="m12 13.75 4-4"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow nav-icon-part-download-left"
            d="m12 13.75-4-4"
          />
          <path
            className="nav-icon-stroke nav-icon-stroke-slow"
            d="M4.5 16.5V19A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5"
          />
        </>
      );
    case "extensions":
      return (
        <g transform="translate(1 1) scale(0.9167)">
          <path
            className="nav-icon-stroke nav-icon-stroke-medium nav-icon-part-extensions"
            d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11Z"
          />
        </g>
      );
    case "settings":
      return (
        <>
          <path
            className="nav-icon-stroke nav-icon-stroke-medium nav-icon-part-settings"
            d="M9.68 4.18 10.1 3h3.8l.42 1.18a2 2 0 0 0 2.62 1.18l1.13-.49 1.9 3.28-.98.76a2 2 0 0 0 0 3.18l.98.76-1.9 3.28-1.13-.49a2 2 0 0 0-2.62 1.18L13.9 18h-3.8l-.42-1.18a2 2 0 0 0-2.62-1.18l-1.13.49-1.9-3.28.98-.76a2 2 0 0 0 0-3.18l-.98-.76 1.9-3.28 1.13.49a2 2 0 0 0 2.62-1.18Z"
          />
          <circle
            className="nav-icon-stroke nav-icon-stroke-slow"
            cx="12"
            cy="10.5"
            r="2.75"
          />
        </>
      );
  }
};

export const AnimatedNavIcon = ({
  name,
  active,
  size = 24,
}: AnimatedNavIconProps) => {
  const firstRender = useRef(true);
  const previousActive = useRef(active);
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      previousActive.current = active;
      return;
    }

    if (active && !previousActive.current) {
      setAnimationKey((key) => key + 1);
    }
    previousActive.current = active;
  }, [active]);

  return (
    <svg
      className={`animated-nav-icon ${active ? "is-active" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <g className="animated-nav-icon-filled">
        <FilledNavIcon name={name} />
      </g>
      <g className="animated-nav-icon-outline" key={animationKey}>
        <OutlineNavIcon name={name} />
      </g>
    </svg>
  );
};
