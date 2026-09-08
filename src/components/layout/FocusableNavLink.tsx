import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { settingsStorage } from "../../lib/storage";
import { useModalFocus, useIsInModal } from "../../lib/context/ModalFocusContext";
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
  const isAndroid =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android");
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const { isModalOpen } = useModalFocus();
  const isInModal = useIsInModal();
  const blockedByModal = isModalOpen && !isInModal;

  // Calculate active state exactly like NavLink does
  const isActive = active ?? (
    location.pathname === to ||
    (to !== "/" && location.pathname.startsWith(to))
  );

  const { ref, focused } = useFocusable({
    focusable: tvMode && !blockedByModal,
    focusKey: propFocusKey,
    onArrowPress: (direction) => {
      // Prevent focus from disappearing off-screen to the left
      if (direction === "left") {
        return false;
      }
      if (direction === "right") {
        if (location.pathname.startsWith("/extensions")) {
          setFocus("EXTENSIONS_SOURCE_PICKER");
          return false;
        }
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

  const computedClassName = typeof className === "function" 
    ? className({ isActive }) 
    : className;

  const content = typeof children === "function"
    ? children({ isActive })
    : children;

  return (
    <button
      {...rest}
      ref={ref as any}
      type="button"
      title={title}
      className={cn(computedClassName, focused && "tv-focus")}
      onClick={() => {
        if (typeof to === "string") {
          navigate(to);
        }
      }}
    >
      {content}
    </button>
  );
};
