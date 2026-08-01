import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-12 w-full rounded-2xl border border-transparent bg-surface-container-high px-4 text-sm text-on-surface outline-none transition-[background-color,border-color,box-shadow] placeholder:text-on-surface-variant focus:border-primary focus:bg-surface-container-highest disabled:cursor-not-allowed disabled:opacity-45",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
