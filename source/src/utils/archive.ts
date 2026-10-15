/**
 * Archiving — the part that is the same for every module.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * Tasks & Issues, Deliverables and Risks have an archive. Documents do not,
 * on purpose. Everything in here is written without naming a
 * module, so the next one costs a checklist rather than a rewrite — PLAN.md
 * 20.9 is that checklist, and 21.4 is the record of it being walked.
 *
 * The archive is TWO optional fields on a record, nothing more. Optional
 * matters: every record already in browser storage and in the Google Sheet
 * stays valid, and an absent field reads as "not archived". There is no
 * migration step and there must never need to be one.
 *
 * What is deliberately NOT here: the action names. `archiveTask` and
 * `unarchiveTask` stay per-module, because three separate tables are keyed on
 * the action name — ACR_ACTIONS in acrDiff.ts, APPLICABLE_ACTIONS in
 * bridgeClient.ts, and getModulePathForTool in AISidebar.tsx. A generic
 * `archiveRecord({ module, id })` would break all three at once.
 * ---------------------------------------------------------------------------
 */

/** The shape a record needs to be archivable. Both fields are optional. */
export interface Archivable {
  /** Absent or false means active. */
  isArchived?: boolean;
  /** Epoch ms. Set when archived, cleared when restored. */
  archivedDate?: number;
}

/** True when the record is in the archive. Safe on null and undefined. */
export const isArchived = (record?: Archivable | null): boolean => !!record?.isArchived;

/** The records the user is still working on. */
export const activeOnly = <T extends Archivable>(rows: T[]): T[] =>
  (rows || []).filter((r) => !r?.isArchived);

/** The records in the archive. */
export const archivedOnly = <T extends Archivable>(rows: T[]): T[] =>
  (rows || []).filter((r) => !!r?.isArchived);

/** The fields to write when archiving. */
export const archivePatch = (): Archivable => ({ isArchived: true, archivedDate: Date.now() });

/** The fields to write when restoring. */
export const restorePatch = (): Archivable => ({ isArchived: false, archivedDate: undefined });

/**
 * Newest archive first. A record with no archivedDate — archived before this
 * field existed, or written by hand — sorts last rather than first, because 0
 * is older than any real timestamp.
 */
export const byArchivedDesc = (a: Archivable, b: Archivable): number =>
  (b?.archivedDate || 0) - (a?.archivedDate || 0);

/**
 * The modules that have an archive. Adding a key here is step 8 of the
 * checklist in PLAN.md 20.9 — it is what the AI read tools accept.
 * 'deliverables' was added 12 Sep; unlike tasks it is a TREE, and the rules
 * that follow from that live in deliverablesStore.ts and PLAN.md 21.2.
 */
export const ARCHIVABLE_MODULES = ['tasks', 'deliverables', 'risks'] as const;

export type ArchivableModule = (typeof ARCHIVABLE_MODULES)[number];

/**
 * The one sentence that tells an AI reader what it cannot see.
 *
 * Written once, called by every module section in the skeleton. The rule this
 * follows is the one aiContextEngine.ts already lives by: the payload says out
 * loud what it is holding back, so the reader learns about the gap from the
 * text instead of from a rule it has to remember.
 *
 * Returns an empty string when nothing is archived, so a caller can append it
 * unconditionally.
 */
export const archivedNotice = (archivedCount: number): string =>
  archivedCount > 0 ? `, ${archivedCount} archived and not listed` : '';
