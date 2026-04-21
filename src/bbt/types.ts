// CSL-JSON and Better BibTeX response shapes.
// BBT's "Better CSL JSON" translator returns an array of items matching CSL-JSON
// plus BBT-specific fields (citation-key, the full author objects, etc.).
//
// We only type the fields we read — anything else flows through as `unknown`
// to avoid false confidence in a schema that BBT is free to extend.

export interface CSLName {
  family?: string;
  given?: string;
  literal?: string;
  "non-dropping-particle"?: string;
  "dropping-particle"?: string;
  suffix?: string;
}

export interface CSLDate {
  "date-parts"?: Array<Array<number | string>>;
  literal?: string;
  raw?: string;
  year?: number;
}

export interface CSLItem {
  id: string;
  "citation-key"?: string;
  type?: string;
  title?: string;
  "container-title"?: string;
  "publisher"?: string;
  "publisher-place"?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  DOI?: string;
  URL?: string;
  ISSN?: string | string[];
  ISBN?: string | string[];
  abstract?: string;
  author?: CSLName[];
  editor?: CSLName[];
  issued?: CSLDate;
  accessed?: CSLDate;
  language?: string;
  keyword?: string; // BBT joins tags with comma
  note?: string;
  // Undocumented / passthrough:
  [k: string]: unknown;
}

export interface BBTAttachment {
  // Shape per BBT `item.attachments`; fields observed in the wild.
  path?: string;
  localPath?: string;
  url?: string;
  title?: string;
  contentType?: string;
  itemType?: string;
  key?: string;         // Zotero item key (for zotero://open-pdf links)
  parentKey?: string;
  /** BBT ≥6.7 returns pre-built zotero:// URIs on each attachment. */
  open?: string;        // zotero://open-pdf/... for this attachment
  select?: string;      // zotero://select/... for the parent item
  annotations?: BBTAnnotation[];
  [k: string]: unknown;
}

export interface BBTAnnotation {
  annotationType?: string; // "highlight" | "note" | "image" | ...
  annotationText?: string;
  annotationComment?: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationPosition?: string | object;
  [k: string]: unknown;
}

export interface BBTNote {
  key?: string;
  note?: string;       // HTML body
  parentKey?: string;
  [k: string]: unknown;
}

export interface BBTLibrary {
  id: number;
  name: string;
  groupID?: number;
  collections: BBTCollection[];
}

export interface BBTCollection {
  key: string;
  name: string;
  collections?: BBTCollection[];
}

/** A hydrated, display-ready item — what the side panel and hover card consume. */
export interface ZoobItem {
  citekey: string;
  zoteroKey?: string;     // Zotero itemKey, for zotero:// links
  libraryID?: number;
  csl: CSLItem;
  attachments: BBTAttachment[];
  notes: BBTNote[];
  /** CSL-formatted HTML entry (from BBT `item.bibliography`), if fetched. */
  formattedHtml?: string;
  /**
   * How much of the item has been fetched. Two-phase hydration renders the
   * list with "meta" (CSL + formatted bibliography only) and then upgrades to
   * "full" once the slower attachments/notes/zoteroKey lookups complete.
   * Missing ⇒ treat as full for backwards compat.
   */
  hydratedLevel?: "meta" | "full";
}
