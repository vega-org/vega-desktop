import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-[themed-shimmer_1.8s_ease-in-out_infinite] rounded-lg bg-[linear-gradient(100deg,var(--skeleton-base)_20%,var(--skeleton-highlight)_45%,var(--skeleton-base)_70%)] bg-[length:220%_100%] motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
