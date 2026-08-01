import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2 border-outline bg-surface-container-highest transition-[background-color,border-color] duration-200 outline-none hover:border-on-surface-variant data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-45",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none absolute left-[6px] top-1/2 block size-4 -translate-y-1/2 rounded-full bg-outline transition-[width,height,transform,background-color] duration-200 data-[state=checked]:size-6 data-[state=checked]:translate-x-4 data-[state=checked]:bg-on-primary" />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
