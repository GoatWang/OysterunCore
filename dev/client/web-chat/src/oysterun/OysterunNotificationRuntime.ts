import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  recordOysterunRouteCNavigationDiagnostic,
  registerOysterunPushToken,
} from './OysterunHostClient';

const OYSTERUN_IOS_APNS_REGISTERED_KEY = 'oysterun-ios-apns-remote-registered-v1';
const OYSTERUN_IOS_APNS_TOKEN_KEY = 'oysterun-ios-apns-token-v1';
const OYSTERUN_IOS_NOTIFICATION_SOUND_ENABLED_KEY = 'oysterun-ios-notification-sound-enabled-v1';
export const OYSTERUN_IOS_SILENT_NOTIFICATION_SOUND = 'oysterun_silent.caf';

export function isOysterunCapacitorIOSRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
}

export function isOysterunIOSRemoteAPNsRegistered(): boolean {
  if (!isOysterunCapacitorIOSRuntime()) return false;
  try {
    return window.localStorage.getItem(OYSTERUN_IOS_APNS_REGISTERED_KEY) === '1';
  } catch {
    return false;
  }
}

export function isOysterunIOSNotificationSoundEnabled(): boolean {
  if (!isOysterunCapacitorIOSRuntime()) return true;
  try {
    return window.localStorage.getItem(OYSTERUN_IOS_NOTIFICATION_SOUND_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

function markOysterunIOSRegistered(token: string): void {
  try {
    window.localStorage.setItem(OYSTERUN_IOS_APNS_REGISTERED_KEY, '1');
    window.localStorage.setItem(OYSTERUN_IOS_APNS_TOKEN_KEY, token);
  } catch {
    /* storage unavailable — registration flag is best-effort */
  }
}

function cachedOysterunIOSApnsToken(): string | null {
  try {
    return window.localStorage.getItem(OYSTERUN_IOS_APNS_TOKEN_KEY);
  } catch {
    return null;
  }
}

let oysterunPushWired = false;
let oysterunPushActionBound = false;

export async function bindOysterunIOSRemotePushNotificationActions(): Promise<void> {
  if (oysterunPushActionBound || !isOysterunCapacitorIOSRuntime()) return;
  oysterunPushActionBound = true;
  try {
    await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      const data = event?.notification?.data || {};
      const url =
        typeof data.url === 'string'
          ? data.url
          : typeof data.oysterun_route === 'string'
            ? data.oysterun_route
            : '';
      if (url && url.startsWith('/app')) {
        recordOysterunRouteCNavigationDiagnostic('notification_navigation', {
          navigation_source: 'web_chat_capacitor_remote_push_action',
          navigation_method: 'location_replace',
          target: url,
        });
        window.location.replace(url);
      }
    });
  } catch (err) {
    oysterunPushActionBound = false;
    // eslint-disable-next-line no-console
    console.warn('[oysterun-push] action listener registration failed', err);
  }
}

/**
 * Wire iOS remote push: request permission, register for an APNs token, and
 * send it to Cloud with the app installation credential. On denied
 * permission, tell Cloud to drop the cached token.
 * Idempotent per app session.
 */
export async function ensureOysterunIOSPushRegistered(): Promise<void> {
  if (!isOysterunCapacitorIOSRuntime() || oysterunPushWired) return;
  oysterunPushWired = true;
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      const token = cachedOysterunIOSApnsToken();
      if (token) {
        await registerOysterunPushToken({
          apns_token: token,
          permission_state: 'denied',
        });
      }
      return;
    }
    await PushNotifications.addListener('registration', async (token) => {
      try {
        await registerOysterunPushToken({
          apns_token: token.value,
          permission_state: 'authorized',
        });
        markOysterunIOSRegistered(token.value);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[oysterun-push] token register POST failed', err);
      }
    });
    await PushNotifications.addListener('registrationError', (err) => {
      // eslint-disable-next-line no-console
      console.warn('[oysterun-push] APNs registration error', err);
    });
    await PushNotifications.register();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[oysterun-push] ensureRegistered failed', err);
  }
}
