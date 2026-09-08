import React, { createContext, useContext } from "react";

const ControlsFocusContext = createContext<boolean>(true);

export const ControlsFocusProvider: React.FC<{
  visible: boolean;
  children: React.ReactNode;
}> = ({ visible, children }) => (
  <ControlsFocusContext.Provider value={visible}>
    {children}
  </ControlsFocusContext.Provider>
);

export const useControlsFocus = () => useContext(ControlsFocusContext);
