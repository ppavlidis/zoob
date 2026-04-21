// Construction of zotero:// URIs.
// Reference: https://www.zotero.org/support/kb/zotero_uris

export function zoteroSelectByKey(zoteroKey: string, libraryID?: number): string {
  const lib = libraryID && libraryID > 1 ? `groups/${libraryID}` : "library";
  return `zotero://select/${lib}/items/${zoteroKey}`;
}

export function zoteroOpenPdfByKey(
  attachmentKey: string,
  libraryID?: number,
  page?: number,
): string {
  const lib = libraryID && libraryID > 1 ? `groups/${libraryID}` : "library";
  const base = `zotero://open-pdf/${lib}/items/${attachmentKey}`;
  return page != null ? `${base}?page=${page}` : base;
}

/** Find the primary PDF attachment among an item's attachments, if any. */
export function primaryPdf<T extends { contentType?: string; path?: string; key?: string }>(
  attachments: T[],
): T | undefined {
  return (
    attachments.find(
      (a) => a.contentType === "application/pdf",
    ) ?? attachments.find((a) => asStr(a.path).toLowerCase().endsWith(".pdf"))
  );
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
