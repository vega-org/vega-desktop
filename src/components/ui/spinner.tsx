import { LuLoaderCircle } from "react-icons/lu";
import { cn } from "../../lib/utils";

interface SpinnerProps {
  className?: string;
  label?: string;
  size?: number;
}

export function Spinner({
  className,
  label = "Loading",
  size = 20,
}: SpinnerProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-loading-indicator",
        className,
      )}
    >
      <LuLoaderCircle
        aria-hidden="true"
        className="animate-spin motion-reduce:animate-none"
        size={size}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
