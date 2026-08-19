import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LuCheck as Check, LuRefreshCw as RefreshCw, LuSettings as SettingsIcon, LuX as X } from "react-icons/lu";
import { FocusableButton } from "../layout/FocusableButton";
import { CustomSelect } from "../CustomSelect";
import { Switch } from "../ui/switch";
import { providerManager } from "../../lib/services/ProviderManager";
import { ProviderExtension } from "../../lib/storage/extensionStorage";
import { SettingsField } from "../../lib/providers/types";
import "./ProviderSettingsDialog.css";

const KV_PREFIX = "vega_provider_kv:";

interface ProviderSettingsDialogProps {
  provider: ProviderExtension | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ProviderSettingsDialog: React.FC<ProviderSettingsDialogProps> = ({
  provider,
  open,
  onOpenChange,
}) => {
  const [fields, setFields] = useState<SettingsField[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || !provider) {
      setFields([]);
      setValues({});
      setSaved(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setSaved(false);

    providerManager
      .getSettingsSchema({ providerValue: provider.value })
      .then((schema) => {
        if (!isMounted) return;
        setFields(schema);

        // Load values from KV storage or default
        const initialValues: Record<string, any> = {};
        for (const field of schema) {
          const raw = localStorage.getItem(KV_PREFIX + field.key);
          if (raw !== null) {
            try {
              initialValues[field.key] = JSON.parse(raw);
            } catch {
              initialValues[field.key] = field.defaultValue;
            }
          } else {
            initialValues[field.key] = field.defaultValue;
          }
        }
        setValues(initialValues);
      })
      .catch((err) => {
        console.error("Failed to load settings schema:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, provider]);

  const handleChange = (key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        localStorage.removeItem(KV_PREFIX + key);
      } else {
        localStorage.setItem(KV_PREFIX + key, JSON.stringify(value));
      }
    }
    setSaved(true);
    setTimeout(() => {
      onOpenChange(false);
    }, 600);
  };

  const handleResetDefaults = () => {
    const defaultValues: Record<string, any> = {};
    for (const field of fields) {
      defaultValues[field.key] = field.defaultValue;
    }
    setValues(defaultValues);
    setSaved(false);
  };

  if (!provider) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="extensions-dialog-overlay" />
        <Dialog.Content className="extensions-dialog-content provider-settings-dialog">
          <div className="extensions-dialog-header">
            <div>
              <Dialog.Title>{provider.display_name} Settings</Dialog.Title>
              <Dialog.Description>
                Configure settings and preferences for this provider.
              </Dialog.Description>
            </div>
            <Dialog.Close className="extensions-dialog-close" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="provider-settings-loading">
              <RefreshCw size={24} className="spin" />
              <span>Loading provider settings...</span>
            </div>
          ) : fields.length === 0 ? (
            <div className="provider-settings-empty">
              <SettingsIcon size={32} />
              <p>This provider does not have any configurable settings.</p>
            </div>
          ) : (
            <div className="provider-settings-form">
              {fields.map((field) => {
                const value = values[field.key];

                if (field.type === "toggle") {
                  return (
                    <div
                      key={field.key}
                      className="provider-settings-field provider-settings-field-toggle"
                    >
                      <div className="provider-settings-label-wrap">
                        <label className="provider-settings-label" htmlFor={`field-${field.key}`}>
                          {field.label}
                        </label>
                        {field.description && (
                          <span className="provider-settings-desc">{field.description}</span>
                        )}
                      </div>
                      <Switch
                        id={`field-${field.key}`}
                        checked={Boolean(value)}
                        onCheckedChange={(checked) => handleChange(field.key, checked)}
                      />
                    </div>
                  );
                }

                if (field.type === "select") {
                  return (
                    <div key={field.key} className="provider-settings-field">
                      <div className="provider-settings-label-wrap">
                        <label className="provider-settings-label">{field.label}</label>
                        {field.description && (
                          <span className="provider-settings-desc">{field.description}</span>
                        )}
                      </div>
                      <CustomSelect
                        className="provider-settings-select"
                        options={field.options}
                        value={String(value ?? field.defaultValue ?? "")}
                        onChange={(selected) => handleChange(field.key, selected)}
                      />
                    </div>
                  );
                }

                if (field.type === "multiselect") {
                  const selectedList: string[] = Array.isArray(value)
                    ? (value as string[])
                    : [];

                  const toggleOption = (optValue: string) => {
                    const exists = selectedList.includes(optValue);
                    const updated = exists
                      ? selectedList.filter((v) => v !== optValue)
                      : [...selectedList, optValue];
                    handleChange(field.key, updated);
                  };

                  return (
                    <div key={field.key} className="provider-settings-field">
                      <div className="provider-settings-label-wrap">
                        <label className="provider-settings-label">{field.label}</label>
                        {field.description && (
                          <span className="provider-settings-desc">{field.description}</span>
                        )}
                      </div>
                      <div className="provider-settings-multiselect-list">
                        {field.options.map((opt) => {
                          const isSelected = selectedList.includes(opt.value);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              className={`provider-settings-checkbox-item ${
                                isSelected ? "selected" : ""
                              }`}
                              onClick={() => toggleOption(opt.value)}
                            >
                              <span className="provider-settings-checkbox-box">
                                {isSelected && <Check size={13} />}
                              </span>
                              <span className="provider-settings-checkbox-label">
                                {opt.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (field.type === "number") {
                  return (
                    <div key={field.key} className="provider-settings-field">
                      <div className="provider-settings-label-wrap">
                        <label className="provider-settings-label" htmlFor={`field-${field.key}`}>
                          {field.label}
                        </label>
                        {field.description && (
                          <span className="provider-settings-desc">{field.description}</span>
                        )}
                      </div>
                      <input
                        id={`field-${field.key}`}
                        type="number"
                        className="provider-settings-input"
                        value={value ?? ""}
                        min={field.min}
                        max={field.max}
                        onChange={(e) =>
                          handleChange(
                            field.key,
                            e.target.value === "" ? undefined : Number(e.target.value),
                          )
                        }
                      />
                    </div>
                  );
                }

                // Default text input
                return (
                  <div key={field.key} className="provider-settings-field">
                    <div className="provider-settings-label-wrap">
                      <label className="provider-settings-label" htmlFor={`field-${field.key}`}>
                        {field.label}
                      </label>
                      {field.description && (
                        <span className="provider-settings-desc">{field.description}</span>
                      )}
                    </div>
                    <input
                      id={`field-${field.key}`}
                      type="text"
                      className="provider-settings-input"
                      value={value ?? ""}
                      placeholder={field.placeholder}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {fields.length > 0 && !loading && (
            <div className="extensions-dialog-actions" style={{ marginTop: 20 }}>
              <FocusableButton
                className="dialog-text-button"
                onClick={handleResetDefaults}
                focusKey={`PROVIDER_SETTINGS_RESET_${provider.value}`}
              >
                Reset Defaults
              </FocusableButton>
              <FocusableButton
                className="dialog-primary-button"
                onClick={handleSave}
                focusKey={`PROVIDER_SETTINGS_SAVE_${provider.value}`}
              >
                {saved ? <Check size={18} /> : null}
                {saved ? "Saved" : "Save Changes"}
              </FocusableButton>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
