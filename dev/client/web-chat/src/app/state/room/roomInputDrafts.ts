import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { Descendant } from 'slate';
import { EncryptedAttachmentInfo } from 'browser-encrypt-attachment';
import { IEventRelation } from 'matrix-js-sdk';
import { createUploadAtomFamily } from '../upload';
import { TUploadContent } from '../../utils/matrix';
import { createListAtom } from '../list';

export type TUploadMetadata = {
  markedAsSpoiler: boolean;
};

export type TUploadItem = {
  file: TUploadContent;
  originalFile: TUploadContent;
  metadata: TUploadMetadata;
  encInfo: EncryptedAttachmentInfo | undefined;
};

export type TUploadListAtom = ReturnType<typeof createListAtom<TUploadItem>>;

export const roomIdToUploadItemsAtomFamily = atomFamily<string, TUploadListAtom>(createListAtom);

export const roomUploadAtomFamily = createUploadAtomFamily();

export type RoomIdToMsgAction =
  | {
      type: 'PUT';
      roomId: string;
      msg: Descendant[];
    }
  | {
      type: 'DELETE';
      roomId: string;
    };

const createMsgDraftAtom = () => atom<Descendant[]>([]);
export type TMsgDraftAtom = ReturnType<typeof createMsgDraftAtom>;
export const roomIdToMsgDraftAtomFamily = atomFamily<string, TMsgDraftAtom>(() =>
  createMsgDraftAtom()
);

export type RouteCComposerDraftScope = {
  storageKey: string;
  hostSessionId: string;
  matrixRoomId: string;
};

type RouteCComposerDraftRecord = {
  host_session_id: string;
  matrix_room_id: string;
  draft: Descendant[];
  updated_at: string;
  browser_storage_contains_credentials: false;
  browser_storage_contains_tokens: false;
  browser_storage_contains_runtime_config: false;
  browser_storage_contains_provider_secrets: false;
};

type RouteCComposerDraftStorage = Record<string, RouteCComposerDraftRecord>;

const ROUTE_C_COMPOSER_DRAFT_STORAGE_KEY = 'oysterun_routec_composer_drafts_v1';

function cloneMsgDraft(draft: Descendant[]): Descendant[] {
  return JSON.parse(JSON.stringify(draft)) as Descendant[];
}

function isRouteCComposerDraftRecord(value: unknown): value is RouteCComposerDraftRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<RouteCComposerDraftRecord>;
  return (
    typeof record.host_session_id === 'string' &&
    typeof record.matrix_room_id === 'string' &&
    Array.isArray(record.draft)
  );
}

function readRouteCComposerDraftStorage(): RouteCComposerDraftStorage {
  if (typeof window === 'undefined') return {};
  try {
    const rawValue = window.localStorage.getItem(ROUTE_C_COMPOSER_DRAFT_STORAGE_KEY);
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => isRouteCComposerDraftRecord(value))
    );
  } catch (err) {
    console.warn('[oysterun-routec] failed to read composer draft storage', err);
    return {};
  }
}

function writeRouteCComposerDraftStorage(storage: RouteCComposerDraftStorage) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ROUTE_C_COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(storage));
  } catch (err) {
    console.warn('[oysterun-routec] failed to write composer draft storage', err);
  }
}

export function createRouteCComposerDraftScope(
  hostSessionId: string,
  matrixRoomId: string
): RouteCComposerDraftScope | undefined {
  const normalizedHostSessionId = hostSessionId.trim();
  const normalizedMatrixRoomId = matrixRoomId.trim();
  if (!normalizedHostSessionId || !normalizedMatrixRoomId) return undefined;
  return {
    storageKey: `${normalizedHostSessionId}\u001f${normalizedMatrixRoomId}`,
    hostSessionId: normalizedHostSessionId,
    matrixRoomId: normalizedMatrixRoomId,
  };
}

export function readRouteCComposerDraft(scope: RouteCComposerDraftScope): Descendant[] {
  const storage = readRouteCComposerDraftStorage();
  const record = storage[scope.storageKey];
  if (!record) return [];
  if (
    record.host_session_id !== scope.hostSessionId ||
    record.matrix_room_id !== scope.matrixRoomId
  ) {
    return [];
  }
  return cloneMsgDraft(record.draft);
}

export function writeRouteCComposerDraft(scope: RouteCComposerDraftScope, draft: Descendant[]) {
  const storage = readRouteCComposerDraftStorage();
  writeRouteCComposerDraftStorage({
    ...storage,
    [scope.storageKey]: {
      host_session_id: scope.hostSessionId,
      matrix_room_id: scope.matrixRoomId,
      draft: cloneMsgDraft(draft),
      updated_at: new Date().toISOString(),
      browser_storage_contains_credentials: false,
      browser_storage_contains_tokens: false,
      browser_storage_contains_runtime_config: false,
      browser_storage_contains_provider_secrets: false,
    },
  });
}

export function deleteRouteCComposerDraft(scope: RouteCComposerDraftScope) {
  const storage = readRouteCComposerDraftStorage();
  if (!storage[scope.storageKey]) return;
  const nextStorage = { ...storage };
  delete nextStorage[scope.storageKey];
  writeRouteCComposerDraftStorage(nextStorage);
}

export type IReplyDraft = {
  userId: string;
  eventId: string;
  body: string;
  formattedBody?: string | undefined;
  relation?: IEventRelation | undefined;
};
const createReplyDraftAtom = () => atom<IReplyDraft | undefined>(undefined);
export type TReplyDraftAtom = ReturnType<typeof createReplyDraftAtom>;
export const roomIdToReplyDraftAtomFamily = atomFamily<string, TReplyDraftAtom>(() =>
  createReplyDraftAtom()
);
