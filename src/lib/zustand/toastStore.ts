import { create } from "zustand";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastItem {
  id: string;
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  showToast: (toast: Omit<ToastItem, "id"> | string) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  showToast: (toast) => {
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const item: ToastItem =
      typeof toast === "string"
        ? { id, message: toast, type: "info", duration: 3500 }
        : { id, duration: 3500, type: "info", ...toast };

    set((state) => ({
      toasts: [...state.toasts, item],
    }));

    if (item.duration && item.duration > 0) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, item.duration);
    }
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

export const toast = (toastInput: Omit<ToastItem, "id"> | string) => {
  useToastStore.getState().showToast(toastInput);
};
