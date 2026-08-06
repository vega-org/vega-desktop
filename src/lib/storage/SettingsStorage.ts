import { mainStorage } from "./StorageService";

/**
 * Storage keys for settings
 */
export enum SettingsKeys {
  // UI preferences
  PRIMARY_COLOR = "primaryColor",
  IS_CUSTOM_THEME = "isCustomTheme",
  SHOW_TAB_BAR_LABELS = "showTabBarLabels",
  CUSTOM_COLOR = "customColor",
  TV_MODE_ENABLED = "tvModeEnabled",
  INFO_PAGE_DYNAMIC_THEME = "infoPageDynamicTheme",
  // Feedback settings
  HAPTIC_FEEDBACK = "hapticFeedback",
  NOTIFICATIONS_ENABLED = "notificationsEnabled",

  // Update settings
  AUTO_CHECK_UPDATE = "autoCheckUpdate",
  AUTO_DOWNLOAD = "autoDownload",

  // Player settings
  SHOW_MEDIA_CONTROLS = "showMediaControls",
  SHOW_HAMBURGER_MENU = "showHamburgerMenu",
  HIDE_SEEK_BUTTONS = "hideSeekButtons",
  ENABLE_2X_GESTURE = "enable2xGesture",
  ENABLE_SWIPE_GESTURE = "enableSwipeGesture",

  // Quality settings
  EXCLUDED_QUALITIES = "excludedQualities",

  // Download settings
  DOWNLOAD_LOCATION = "downloadLocation",
  DOWNLOAD_CONCURRENCY = "downloadConcurrency",

  // Subtitle settings
  SUBTITLE_FONT_SIZE = "subtitleFontSize",
  SUBTITLE_FONT_FAMILY = "subtitleFontFamily",
  SUBTITLE_FONT_WEIGHT = "subtitleFontWeight",
  SUBTITLE_OUTLINE_SIZE = "subtitleOutlineSize",
  SUBTITLE_BOTTOM_PADDING = "subtitleBottomPadding",

  LIST_VIEW_TYPE = "viewType",

  // Telemetry (privacy)
  TELEMETRY_OPT_IN = "telemetryOptIn",

  // Advanced settings
  HARDWARE_ACCELERATION = "hardwareAcceleration",
  DEVTOOLS_SHORTCUTS_ENABLED = "devtoolsShortcutsEnabled",
  TMDB_API_KEY = "tmdbApiKey",
  TMDB_API_KEY_REVISION = "tmdbApiKeyRevision",
  VLC_ENABLED = "vlcEnabled",
  VLC_PATH = "vlcPath",
}

/**
 * Settings storage manager
 */
export class SettingsStorage {
  // Theme settings
  getPrimaryColor(): string {
    return mainStorage.getString(SettingsKeys.PRIMARY_COLOR) || "#FF6347";
  }

  setPrimaryColor(color: string): void {
    mainStorage.setString(SettingsKeys.PRIMARY_COLOR, color);
  }

  isCustomTheme(): boolean {
    return mainStorage.getBool(SettingsKeys.IS_CUSTOM_THEME);
  }

  setCustomTheme(isCustom: boolean): void {
    mainStorage.setBool(SettingsKeys.IS_CUSTOM_THEME, isCustom);
  }

  getCustomColor(): string {
    return mainStorage.getString(SettingsKeys.CUSTOM_COLOR) || "#FF6347";
  }

  setCustomColor(color: string): void {
    mainStorage.setString(SettingsKeys.CUSTOM_COLOR, color);
  }

  // UI preferences
  showTabBarLabels(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_TAB_BAR_LABELS, false);
  }

  setShowTabBarLabels(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_TAB_BAR_LABELS, show);
  }

  isTvModeEnabled(): boolean {
    const defaultTvMode = import.meta.env.VITE_TV_MODE === "true";
    return mainStorage.getBool(SettingsKeys.TV_MODE_ENABLED, defaultTvMode);
  }

  setTvModeEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.TV_MODE_ENABLED, enabled);
  }

  isInfoPageDynamicThemeEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.INFO_PAGE_DYNAMIC_THEME, true);
  }

  setInfoPageDynamicThemeEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.INFO_PAGE_DYNAMIC_THEME, enabled);
  }

  areDevtoolsShortcutsEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.DEVTOOLS_SHORTCUTS_ENABLED, false);
  }

  setDevtoolsShortcutsEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.DEVTOOLS_SHORTCUTS_ENABLED, enabled);
  }

  getTmdbApiKey(): string {
    return (mainStorage.getString(SettingsKeys.TMDB_API_KEY) || "").trim();
  }

  setTmdbApiKey(apiKey: string): void {
    mainStorage.setString(SettingsKeys.TMDB_API_KEY, apiKey.trim());
    mainStorage.setNumber(
      SettingsKeys.TMDB_API_KEY_REVISION,
      this.getTmdbApiKeyRevision() + 1,
    );
  }

  getDefaultVlcPath(): string {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("windows")) {
      return "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe";
    }
    if (userAgent.includes("mac")) {
      return "/Applications/VLC.app/Contents/MacOS/VLC";
    }
    return "/usr/bin/vlc";
  }

  getVlcPath(): string {
    return mainStorage.getString(SettingsKeys.VLC_PATH) || this.getDefaultVlcPath();
  }

  isVlcEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.VLC_ENABLED, false);
  }

  setVlcEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.VLC_ENABLED, enabled);
  }

  setVlcPath(path: string): void {
    mainStorage.setString(SettingsKeys.VLC_PATH, path.trim());
  }

  resetVlcPath(): void {
    mainStorage.delete(SettingsKeys.VLC_PATH);
  }

  getTmdbApiKeyRevision(): number {
    return mainStorage.getNumber(SettingsKeys.TMDB_API_KEY_REVISION) || 0;
  }

  isHapticFeedbackEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.HAPTIC_FEEDBACK, true);
  }
  setHapticFeedbackEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.HAPTIC_FEEDBACK, enabled);
  }

  isNotificationsEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.NOTIFICATIONS_ENABLED, true);
  }

  setNotificationsEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.NOTIFICATIONS_ENABLED, enabled);
  }

  // Update settings
  isAutoCheckUpdateEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.AUTO_CHECK_UPDATE, true);
  }

  setAutoCheckUpdateEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.AUTO_CHECK_UPDATE, enabled);
  }

  isAutoDownloadEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.AUTO_DOWNLOAD, true);
  }

  setAutoDownloadEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.AUTO_DOWNLOAD, enabled);
  }

  // Player settings
  showMediaControls(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_MEDIA_CONTROLS, true);
  }

  setShowMediaControls(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_MEDIA_CONTROLS, show);
  }

  showHamburgerMenu(): boolean {
    return mainStorage.getBool(SettingsKeys.SHOW_HAMBURGER_MENU) === null
      ? true
      : mainStorage.getBool(SettingsKeys.SHOW_HAMBURGER_MENU);
  }

  setShowHamburgerMenu(show: boolean): void {
    mainStorage.setBool(SettingsKeys.SHOW_HAMBURGER_MENU, show);
  }

  hideSeekButtons(): boolean {
    return mainStorage.getBool(SettingsKeys.HIDE_SEEK_BUTTONS);
  }

  setHideSeekButtons(hide: boolean): void {
    mainStorage.setBool(SettingsKeys.HIDE_SEEK_BUTTONS, hide);
  }

  isEnable2xGestureEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.ENABLE_2X_GESTURE);
  }

  setEnable2xGesture(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.ENABLE_2X_GESTURE, enabled);
  }

  isSwipeGestureEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.ENABLE_SWIPE_GESTURE, true) === null
      ? true
      : mainStorage.getBool(SettingsKeys.ENABLE_SWIPE_GESTURE, true);
  }

  setSwipeGestureEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.ENABLE_SWIPE_GESTURE, enabled);
  }

  // Quality settings
  getExcludedQualities(): string[] {
    return mainStorage.getArray<string>(SettingsKeys.EXCLUDED_QUALITIES) || [];
  }

  setExcludedQualities(qualities: string[]): void {
    mainStorage.setArray(SettingsKeys.EXCLUDED_QUALITIES, qualities);
  }

  getDownloadLocation(): string {
    return mainStorage.getString(SettingsKeys.DOWNLOAD_LOCATION) || "vega";
  }

  setDownloadLocation(location: string): void {
    mainStorage.setString(SettingsKeys.DOWNLOAD_LOCATION, location);
  }

  resetDownloadLocation(): void {
    mainStorage.setString(SettingsKeys.DOWNLOAD_LOCATION, "vega");
  }

  getDownloadConcurrency(): number {
    const value = mainStorage.getNumber(SettingsKeys.DOWNLOAD_CONCURRENCY);
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(Math.max(Math.round(value), 1), 5)
      : 2;
  }

  setDownloadConcurrency(value: number): void {
    mainStorage.setNumber(
      SettingsKeys.DOWNLOAD_CONCURRENCY,
      Math.min(Math.max(Math.round(value), 1), 5),
    );
  }

  // Subtitle settings
  getSubtitleFontSize(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_FONT_SIZE) || 16;
  }

  setSubtitleFontSize(size: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_FONT_SIZE, size);
  }

  getSubtitleFontFamily(): string {
    return (
      mainStorage.getString(SettingsKeys.SUBTITLE_FONT_FAMILY) || "sans-serif"
    );
  }

  setSubtitleFontFamily(family: string): void {
    mainStorage.setString(SettingsKeys.SUBTITLE_FONT_FAMILY, family);
  }

  getSubtitleFontWeight(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_FONT_WEIGHT) || 400;
  }

  setSubtitleFontWeight(weight: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_FONT_WEIGHT, weight);
  }

  getSubtitleOutlineSize(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_OUTLINE_SIZE) || 2;
  }

  setSubtitleOutlineSize(size: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_OUTLINE_SIZE, size);
  }

  getSubtitleBottomPadding(): number {
    return mainStorage.getNumber(SettingsKeys.SUBTITLE_BOTTOM_PADDING) || 10;
  }

  setSubtitleBottomPadding(padding: number): void {
    mainStorage.setNumber(SettingsKeys.SUBTITLE_BOTTOM_PADDING, padding);
  }

  getListViewType(): number {
    return parseInt(
      mainStorage.getString(SettingsKeys.LIST_VIEW_TYPE) || "1",
      10,
    );
  }

  setListViewType(type: number): void {
    mainStorage.setString(SettingsKeys.LIST_VIEW_TYPE, type.toString());
  }

  // Telemetry / Privacy
  isTelemetryOptIn(): boolean {
    const val = mainStorage.getBool(SettingsKeys.TELEMETRY_OPT_IN);
    // Default to true (opted in) unless explicitly disabled
    return val === null ? true : (val as boolean);
  }

  setTelemetryOptIn(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.TELEMETRY_OPT_IN, enabled);
  }

  // Advanced Settings
  isHardwareAccelerationEnabled(): boolean {
    return mainStorage.getBool(SettingsKeys.HARDWARE_ACCELERATION, false);
  }

  setHardwareAccelerationEnabled(enabled: boolean): void {
    mainStorage.setBool(SettingsKeys.HARDWARE_ACCELERATION, enabled);
  }

  // Generic get/set methods for settings not covered by specific methods
  getBool(key: string, defaultValue = false): boolean {
    return mainStorage.getBool(key, defaultValue);
  }

  setBool(key: string, value: boolean): void {
    mainStorage.setBool(key, value);
  }

  // DNS over HTTPS (DoH) settings
  isDohEnabled(): boolean {
    // Default to true as in mobile app
    return mainStorage.getBool("dohEnabled", true);
  }

  setDohEnabled(enabled: boolean): void {
    mainStorage.setBool("dohEnabled", enabled);
  }

  getDohProvider(): string {
    return mainStorage.getString("dohProvider") || "cloudflare";
  }

  setDohProvider(provider: string): void {
    mainStorage.setString("dohProvider", provider);
  }

  getDohCustomUrl(): string {
    return mainStorage.getString("dohCustomUrl") || "";
  }

  setDohCustomUrl(url: string): void {
    mainStorage.setString("dohCustomUrl", url);
  }
}

// Export a singleton instance
export const settingsStorage = new SettingsStorage();
