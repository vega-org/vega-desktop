import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { settingsStorage } from "../storage";
export interface Theme {
  primary: string;
  isCustom: boolean;
  setPrimary: (type: Theme["primary"]) => void;
  setCustom: (isCustom: boolean) => void;
}

const useThemeStore = create<Theme>()(
  persist(
    (set) => ({
      primary: settingsStorage.getPrimaryColor(),
      isCustom: settingsStorage.isCustomTheme(),

      setPrimary: (primary: Theme["primary"]) => {
        set({ primary });
        settingsStorage.setPrimaryColor(primary);
      },
      setCustom: (isCustom: Theme["isCustom"]) => {
        set({ isCustom });
        settingsStorage.setCustomTheme(isCustom);
      },
    }),
    {
      name: "theme-storage",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export default useThemeStore;
