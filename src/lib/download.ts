/** Hand a generated file to the browser's download flow. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click has been dispatched; some browsers read the URL
  // asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadText(
  text: string,
  fileName: string,
  mimeType = "text/plain;charset=utf-8",
): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}

export function downloadJson(value: unknown, fileName: string): void {
  downloadText(
    `${JSON.stringify(value, null, 2)}\n`,
    fileName,
    "application/json;charset=utf-8",
  );
}
