import React from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation-react';
import { settingsStorage } from '../../lib/storage';
import { useModalFocus, useIsInModal } from '../../lib/context/ModalFocusContext';
import { useControlsFocus } from '../../lib/context/ControlsFocusContext';

export interface FocusableButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  // If true, will not take focus
  disabled?: boolean;
  focusKey?: string;
  focusable?: boolean;
  onEnterPress?: () => void;
  onArrowPress?: (direction: string) => boolean;
}

export const FocusableButton: React.FC<FocusableButtonProps> = ({ 
  children, 
  onClick, 
  onKeyDown,
  className = '', 
  disabled = false,
  focusKey,
  focusable: propFocusable,
  onEnterPress,
  onArrowPress,
  tabIndex,
  type: _type,
  ...rest 
}) => {
  const isAndroid =
    typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('android');
  const tvMode = settingsStorage.isTvModeEnabled() || isAndroid;
  const { isModalOpen } = useModalFocus();
  const isInModal = useIsInModal();
  const blockedByModal = isModalOpen && !isInModal;
  const isControlsVisible = useControlsFocus();

  const isAllowedMode = isInModal || tvMode;
  const canFocus =
    isAllowedMode &&
    isControlsVisible &&
    (propFocusable !== undefined ? propFocusable : true) &&
    !disabled &&
    !blockedByModal;

  const { ref, focused } = useFocusable({
    focusable: canFocus,
    focusKey,
    onEnterPress: () => {
      onEnterPress?.();
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
    onArrowPress,
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
      tabIndex={disabled || tvMode || !isControlsVisible ? -1 : (tabIndex ?? 0)}
      className={`${className} ${focused && isAllowedMode && isControlsVisible ? 'tv-focus' : ''}`.trim()}
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
