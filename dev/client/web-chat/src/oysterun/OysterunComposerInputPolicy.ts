import { Capacitor } from '@capacitor/core';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

const PHONE_BROWSER_USER_AGENT_PATTERN = /\b(iPhone|iPod|Windows Phone)\b|Android.+Mobile/i;

export function isOysterunPhoneComposerMode(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof navigator === 'undefined') return false;

  const { userAgentData } = navigator as NavigatorWithUserAgentData;
  if (userAgentData?.mobile === true) return true;

  const { userAgent } = navigator;
  return PHONE_BROWSER_USER_AGENT_PATTERN.test(userAgent);
}
