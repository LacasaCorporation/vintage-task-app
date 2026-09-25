/**
 * Turn a backup document from `api.backup.exportBackup` into a dated JSON
 * file download.
 */
export function downloadBackupFile(backup: unknown) {
  const doc = backup as { exportedAt?: number } | null;
  const stamp = doc?.exportedAt
    ? new Date(doc.exportedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19)
    : new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `slate-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
