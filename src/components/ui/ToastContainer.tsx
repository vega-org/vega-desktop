import React from "react";
import { useToastStore, ToastItem } from "../../lib/zustand/toastStore";
import {
  FiCheckCircle,
  FiAlertCircle,
  FiInfo,
  FiAlertTriangle,
  FiX,
} from "react-icons/fi";
import "./ToastContainer.css";

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  const renderIcon = (type?: ToastItem["type"]) => {
    switch (type) {
      case "success":
        return <FiCheckCircle className="toast-icon toast-icon-success" />;
      case "error":
        return <FiAlertCircle className="toast-icon toast-icon-error" />;
      case "warning":
        return <FiAlertTriangle className="toast-icon toast-icon-warning" />;
      case "info":
      default:
        return <FiInfo className="toast-icon toast-icon-info" />;
    }
  };

  return (
    <div className="global-toast-container">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`global-toast-item global-toast-${item.type || "info"}`}
          onClick={() => removeToast(item.id)}
        >
          <div className="toast-left-indicator" />
          <div className="toast-content-wrapper">
            {renderIcon(item.type)}
            <div className="toast-text-container">
              {item.title && <div className="toast-title">{item.title}</div>}
              <div className="toast-message">{item.message}</div>
            </div>
            <button
              className="toast-close-button"
              onClick={(e) => {
                e.stopPropagation();
                removeToast(item.id);
              }}
              aria-label="Close toast"
            >
              <FiX size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
