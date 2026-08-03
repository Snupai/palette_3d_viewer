let gripIdCounter = 0;

export function createGripId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return randomId;
  gripIdCounter += 1;
  return `grip-${Date.now()}-${gripIdCounter}`;
}
