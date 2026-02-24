import { useToastStore } from "@/stores/toastStore";

export const toast = {
  success: (title: string, message?: string) => {
    useToastStore.getState().addToast({ type: "success", title, message });
  },
  error: (title: string, message?: string) => {
    useToastStore.getState().addToast({ type: "error", title, message });
  },
  warning: (title: string, message?: string) => {
    useToastStore.getState().addToast({ type: "warning", title, message });
  },
  info: (title: string, message?: string) => {
    useToastStore.getState().addToast({ type: "info", title, message });
  },
};
