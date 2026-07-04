import ClaudeAvatarUrl from '../../public/res/oysterun/avatars/claude.png';
import CodexAvatarUrl from '../../public/res/oysterun/avatars/codex.png';
import BrainAvatarUrl from '../../public/res/oysterun/avatars/brain.png';
import OysterunAvatarUrl from '../../public/res/oysterun/avatars/oysterun.png';
import ToolAvatarUrl from '../../public/res/oysterun/avatars/tool.png';

const OYSTERUN_SEMANTIC_NAMESPACE = 'org.oysterun.semantic.v1';

const OYSTERUN_ROUTE_C_AVATAR_ASSETS = {
  claude: ClaudeAvatarUrl,
  codex: CodexAvatarUrl,
  brain: BrainAvatarUrl,
  tool: ToolAvatarUrl,
  oysterun: OysterunAvatarUrl,
} as const;

type OysterunRouteCMessageAvatarInput = {
  content: unknown;
  senderDisplayName: string;
};

function readSemanticPayload(content: unknown): Record<string, unknown> | undefined {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;
  const payload = (content as Record<string, unknown>)[OYSTERUN_SEMANTIC_NAMESPACE];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return payload as Record<string, unknown>;
}

function stringField(record: Record<string, unknown> | undefined, field: string): string {
  const value = record?.[field];
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function getOysterunRouteCMessageAvatarSrc({
  content,
  senderDisplayName,
}: OysterunRouteCMessageAvatarInput): string | undefined {
  const payload = readSemanticPayload(content);
  const actorKey = normalize(stringField(payload, 'matrix_event_sender_actor_key'));
  const actorKind = normalize(stringField(payload, 'matrix_event_sender_actor_kind'));
  const payloadDisplayName = stringField(payload, 'matrix_event_sender_display_name');
  const displayName = normalize(payloadDisplayName || senderDisplayName);
  const providerId = normalize(stringField(payload, 'provider_id') || stringField(payload, 'provider'));
  const semanticType = normalize(
    stringField(payload, 'semantic_type') || stringField(payload, 'semantic_category')
  );

  if (actorKey === 'human' || displayName === 'host owner') {
    return undefined;
  }

  if (semanticType === 'thinking.reasoning') {
    return OYSTERUN_ROUTE_C_AVATAR_ASSETS.brain;
  }

  if (
    actorKey === 'tool' ||
    actorKind === 'tool' ||
    displayName === 'oysterun tool' ||
    semanticType.startsWith('tool.')
  ) {
    return OYSTERUN_ROUTE_C_AVATAR_ASSETS.tool;
  }

  if (
    actorKey === 'host' ||
    actorKind === 'host' ||
    actorKey === 'control' ||
    actorKey.startsWith('control:') ||
    actorKind === 'control' ||
    displayName === 'oysterun host' ||
    displayName === 'oysterun control' ||
    displayName.endsWith(' control') ||
    semanticType.startsWith('control.')
  ) {
    return OYSTERUN_ROUTE_C_AVATAR_ASSETS.oysterun;
  }

  if (actorKey === 'assistant:claude' || providerId === 'claude' || displayName === 'claude') {
    return OYSTERUN_ROUTE_C_AVATAR_ASSETS.claude;
  }

  if (actorKey === 'assistant:codex' || providerId === 'codex' || displayName === 'codex') {
    return OYSTERUN_ROUTE_C_AVATAR_ASSETS.codex;
  }

  return undefined;
}
