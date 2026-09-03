// Channel pools only retry failures that invalidate the shared SSH transport itself.
export function isConnectionLevelSshError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // RFC 4254 channel-open failures describe one rejected logical channel (for example MaxSessions
  // resource shortage), not a dead SSH transport. Reconnecting the shared Client for those errors
  // tears down App Server, terminals, SFTP, and previews that are still healthy.
  if (/Channel open failure/i.test(message)) return false;
  return /No response from server|Not connected|Connection lost|ECONNRESET|EPIPE/i.test(message);
}

/** OpenSSH uses this description when a session channel briefly exceeds MaxSessions. */
export function isRetryableSshChannelOpenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Channel open failure:\s*open failed/i.test(message);
}
