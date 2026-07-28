export const getErrorMessage = (error: unknown, fallback = "Unknown error") => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  try {
    return JSON.stringify(error) || fallback;
  } catch {
    return fallback;
  }
};
