import { Room } from 'matrix-js-sdk';

export function isRouteCRoomEntryTimelineUsable(
  room: Room | undefined,
  matrixRoomId: string | undefined
): boolean {
  if (!room || !matrixRoomId || room.roomId !== matrixRoomId) return false;
  const liveTimeline = room.getUnfilteredTimelineSet().getLiveTimeline();
  return Boolean(liveTimeline && liveTimeline.getRoomId() === matrixRoomId);
}
