import {
  isOysterunCapacitorIOSRuntime,
  isOysterunIOSNotificationSoundEnabled,
  isOysterunIOSRemoteAPNsRegistered,
  OYSTERUN_IOS_SILENT_NOTIFICATION_SOUND,
} from './OysterunNotificationRuntime';
import {
  getOysterunSemanticPayload,
} from './OysterunSemanticRenderer';
import {
  normalizeOysterunCompleteMessageNotificationCandidateInput,
  normalizeOysterunCompleteMessageNotificationReleaseInput,
} from './OysterunCompleteMessageNotificationPredicate';

export type OysterunCompleteMessageNotificationCandidate = {
  source: 'matrix_committed_event';
  key: string;
  roomId: string;
  eventId: string;
  matrixEventId: string;
  matrixRoomId: string;
  hostSessionId?: string;
  sessionId: string;
  semanticId?: string;
  assistantContentHash?: string;
  providerTurnId?: string;
  semanticType?: string;
  notifiableOutputType?: string;
  title: string;
  body: string;
  url: string;
};

export type OysterunCompleteMessageNotificationRelease = {
  source: 'matrix_provider_completion_marker';
  matrixEventId: string;
  matrixRoomId: string;
  hostSessionId: string;
  sessionId: string;
  providerTurnId: string;
  status: string;
  state: string;
  expectedState: string;
  successful: boolean;
};

type OysterunCompleteMessageMatrixEvent = {
  getContent(): Record<string, unknown>;
  getType(): string;
  getId(): string | undefined;
};

type OysterunCompleteMessageMatrixRoom = {
  roomId: string;
};

const handledKeys = new Set<string>();
let iosNotificationActionBound = false;

function normalizeString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function rememberHandledKey(key: string): boolean {
  if (!key || handledKeys.has(key)) return false;
  handledKeys.add(key);
  if (handledKeys.size > 500) {
    const oldest = handledKeys.values().next().value;
    if (oldest) handledKeys.delete(oldest);
  }
  return true;
}

export function rememberOysterunCompleteMessageNotificationKey(key: string): boolean {
  return rememberHandledKey(key);
}

export function getOysterunCompleteMessageNotificationCandidateFromMatrixEvent(
  mEvent: OysterunCompleteMessageMatrixEvent,
  room: OysterunCompleteMessageMatrixRoom,
  {
    sessionName,
    url,
  }: {
    sessionName?: string;
    url: string;
  }
): OysterunCompleteMessageNotificationCandidate | undefined {
  const content = mEvent.getContent();
  const payload = getOysterunSemanticPayload(content);
  const result = normalizeOysterunCompleteMessageNotificationCandidateInput({
    eventType: mEvent.getType(),
    matrixEventId: mEvent.getId(),
    matrixRoomId: payload?.matrix_room_id,
    hostSessionId: payload?.host_session_id,
    roomId: room.roomId,
    contentBody: normalizeString((content as { body?: unknown })?.body),
    contentDelta: (content as { delta?: unknown })?.delta === true,
    semanticPayload: payload,
    sessionName,
    url,
    windowHost: window.location.host || window.location.hostname || '',
  });
  return result.accepted
    ? (result.candidate as OysterunCompleteMessageNotificationCandidate)
    : undefined;
}

export function getOysterunCompleteMessageNotificationReleaseFromMatrixEvent(
  mEvent: OysterunCompleteMessageMatrixEvent,
  room: OysterunCompleteMessageMatrixRoom
): OysterunCompleteMessageNotificationRelease | undefined {
  const content = mEvent.getContent();
  const payload = getOysterunSemanticPayload(content);
  const result = normalizeOysterunCompleteMessageNotificationReleaseInput({
    eventType: mEvent.getType(),
    matrixEventId: mEvent.getId(),
    matrixRoomId: payload?.matrix_room_id,
    hostSessionId: payload?.host_session_id,
    roomId: room.roomId,
    semanticPayload: payload,
  });
  return result.accepted
    ? (result.release as OysterunCompleteMessageNotificationRelease)
    : undefined;
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  if (!window.isSecureContext) return undefined;
  const timeout = new Promise<undefined>((resolve) => {
    window.setTimeout(() => resolve(undefined), 800);
  });
  const registration = await Promise.race([navigator.serviceWorker.ready, timeout]);
  if (registration && typeof registration.showNotification === 'function') {
    return registration;
  }
  return undefined;
}

async function showBrowserNotification(
  candidate: OysterunCompleteMessageNotificationCandidate,
  icon: string,
  onClick: () => void
): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (window.Notification.permission !== 'granted') return false;

  const options: NotificationOptions = {
    icon,
    badge: icon,
    body: candidate.body,
    tag: candidate.key,
    data: {
      url: candidate.url,
    },
  };

  const registration = await getReadyServiceWorkerRegistration();
  if (registration) {
    try {
      await registration.showNotification(candidate.title, options);
      return true;
    } catch (err) {
      console.warn('Oysterun web notification service worker showNotification failed', err);
    }
  }

  const noti = new window.Notification(candidate.title, options);
  noti.onclick = () => {
    onClick();
    noti.close();
  };
  return true;
}

function stableIOSLocalNotificationId(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return ((hash >>> 0) % 2147483646) + 1;
}

async function showIOSLocalNotification(
  candidate: OysterunCompleteMessageNotificationCandidate
): Promise<boolean> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  // Permission prompting is owned by the Host /app sessions/preferences layer.
  const permissions = await LocalNotifications.checkPermissions();
  if (permissions.display !== 'granted') return false;

  const notification = {
    id: stableIOSLocalNotificationId(candidate.key),
    title: candidate.title,
    body: candidate.body,
    threadIdentifier: candidate.sessionId || 'oysterun',
    extra: {
      oysterun_type: 'assistant_message',
      host_session_id: candidate.sessionId,
      matrix_event_id: candidate.matrixEventId,
      room_id: candidate.roomId,
      event_id: candidate.eventId,
      semantic_id: candidate.semanticId,
      assistant_content_hash: candidate.assistantContentHash,
      provider_turn_id: candidate.providerTurnId,
      semantic_type: candidate.semanticType,
      notifiable_output_type: candidate.notifiableOutputType,
      url: candidate.url,
    },
    sound: isOysterunIOSNotificationSoundEnabled()
      ? 'default'
      : OYSTERUN_IOS_SILENT_NOTIFICATION_SOUND,
  };

  await LocalNotifications.schedule({
    notifications: [notification],
  });
  return true;
}

export async function bindOysterunIOSLocalNotificationActions(): Promise<void> {
  if (iosNotificationActionBound || !isOysterunCapacitorIOSRuntime()) return;
  iosNotificationActionBound = true;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const extra = notification?.extra || {};
    const url = typeof extra.url === 'string' ? extra.url : '';
    if (url && url.startsWith('/app')) {
      window.location.assign(url);
    }
  });
}

export async function notifyOysterunCompleteMessage(
  candidate: OysterunCompleteMessageNotificationCandidate,
  {
    icon,
    onClick,
  }: {
    icon: string;
    onClick: () => void;
  }
): Promise<boolean> {
  if (isOysterunCapacitorIOSRuntime()) {
    if (isOysterunIOSRemoteAPNsRegistered()) return false;
    return showIOSLocalNotification(candidate);
  }
  return showBrowserNotification(candidate, icon, onClick);
}
