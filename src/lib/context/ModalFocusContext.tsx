import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";

interface ModalFocusContextType {
  isModalOpen: boolean;
  registerModal: () => () => void;
}

const ModalFocusContext = createContext<ModalFocusContextType>({
  isModalOpen: false,
  registerModal: () => () => {},
});

const InModalContext = createContext<boolean>(false);

export const ModalFocusProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [modalCount, setModalCount] = useState(0);

  const registerModal = useCallback(() => {
    setModalCount((count) => count + 1);
    return () => {
      setModalCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const value = useMemo(
    () => ({
      isModalOpen: modalCount > 0,
      registerModal,
    }),
    [modalCount, registerModal],
  );

  return (
    <ModalFocusContext.Provider value={value}>
      {children}
    </ModalFocusContext.Provider>
  );
};

export const useModalFocus = () => useContext(ModalFocusContext);

export const InModalProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <InModalContext.Provider value={true}>{children}</InModalContext.Provider>;

export const useIsInModal = () => useContext(InModalContext);
