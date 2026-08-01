import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,color,box-shadow,transform] duration-200 outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        filled:
          "bg-primary-container text-on-primary-container shadow-sm hover:brightness-110 active:scale-[0.98]",
        tonal:
          "bg-primary-container text-on-primary-container hover:brightness-110 active:scale-[0.98]",
        outline:
          "border border-outline bg-transparent text-primary hover:bg-primary/10 active:scale-[0.98]",
        ghost:
          "bg-transparent text-on-surface hover:bg-surface-container-high active:scale-[0.98]",
        danger:
          "bg-error-container text-on-error-container hover:brightness-110 active:scale-[0.98]",
      },
      size: {
        sm: "h-8 rounded-full px-3 text-xs [&_svg]:size-4",
        default: "h-10 rounded-full px-5 text-sm [&_svg]:size-5",
        lg: "h-12 rounded-full px-6 text-base [&_svg]:size-5",
        icon: "size-10 rounded-full p-0 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "filled",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
