let privacyMode = false;

export const isPrivacyMode = () => privacyMode;

export const setPrivacyMode = (enabled: boolean) => {
  privacyMode = enabled;
};

export const redactMoney = (formatted: string, currency = "€") => isPrivacyMode() ? `•••• ${currency}` : formatted;
