import React from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';
import { settingsStorage } from '../../lib/storage';

interface FocusableButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  // If true, will not take focus
  disabled?: boolean;
  focusKey?: string;
}

export const FocusableButton: React.FC<FocusableButtonProps> = ({ 
  children, 
  onClick, 
  onKeyDown,
  className = '', 
  disabled = false,
  focusKey,
  tabIndex,
  type: _type,
  ...rest 
}) => {
  const isAndroid = navigator.userAgent.toLowerCase().includes('android');
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const { ref, focused } = useFocusable({
    focusable: tvMode && !disabled,
    focusKey,
    onEnterPress: () => {
      if (onClick) {
        // Mock a React.MouseEvent to prevent crashes when stopPropagation is called
        onClick({
          stopPropagation: () => {},
          preventDefault: () => {},
          target: ref.current,
          currentTarget: ref.current
        } as any);
      }
    },
    onFocus: (layout) => {
      layout.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  return (
    <div
      {...rest as any}
      // @ts-ignore
      ref={ref}
      role="button"
      aria-disabled={disabled || undefined}
      tabIndex={disabled || tvMode ? -1 : (tabIndex ?? 0)}
      className={`${className} ${focused ? 'tv-focus' : ''}`.trim()}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event as any);
        if (event.defaultPrevented || disabled || tvMode) return;

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.(event as any);
        }
      }}
      style={{ ...rest.style, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      {children}
    </div>
  );
};
