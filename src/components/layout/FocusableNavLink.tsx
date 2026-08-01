import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { settingsStorage } from "../../lib/storage";
import { cn } from "../../lib/utils";

export interface FocusableNavLinkProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "children"
> {
  to: string;
  title?: string;
  focusKey?: string;
  active?: boolean;
  className?: string | ((props: { isActive: boolean }) => string);
  children?:
    | React.ReactNode
    | ((props: { isActive: boolean }) => React.ReactNode);
}

export const FocusableNavLink: React.FC<FocusableNavLinkProps> = ({
  to,
  title,
  focusKey: propFocusKey,
  active,
  children,
  className,
  ...rest
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const tvMode = settingsStorage.isTvModeEnabled();

  // Calculate active state exactly like NavLink does
  const isActive = active ?? (
    location.pathname === to ||
    (to !== "/" && location.pathname.startsWith(to))
  );

  const { ref, focused } = useFocusable({
    focusable: tvMode,
    focusKey: propFocusKey,
    onArrowPress: (direction) => {
      // Prevent focus from disappearing off-screen to the left
      if (direction === "left") {
        return false;
      }
      return true;
    },
    onEnterPress: () => {
      if (typeof to === "string") {
        navigate(to);
      }
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });

  const baseClass =
    typeof className === "function" ? className({ isActive }) : className;
  const finalClass = cn(baseClass, focused && "tv-focus");

  return (
    <button
      type="button"
      {...rest}
      ref={ref}
      title={title}
      aria-label={title}
      aria-current={isActive ? "page" : undefined}
      className={finalClass}
      onClick={() => {
        if (typeof to === "string") {
          navigate(to);
        }
      }}
    >
      {typeof children === "function" ? children({ isActive }) : children}
    </button>
  );
};
