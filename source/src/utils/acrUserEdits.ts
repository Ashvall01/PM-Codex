/**
 * The user's own edits to a pending proposal — and the rule that protects them.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The user can edit any line of a pending change request before signing it
 * off: retype a remark, move a date, rewrite a whole Codex page. Until 30 Sep
 * 2026 nothing recorded that they had. The request's `updatedAt` moved, but it
 * also moves when a box is ticked or unticked, so it told nobody anything.
 *
 * On 30 Sep the user edited a WSR page Claude had proposed. Claude then
 * withdrew that line (to fix something else in it) and filed a fresh copy
 * built from its own text. The user's edit was gone, with no warning and no
 * way back: a withdrawn line is deleted, not archived.
 *
 * There was a second, quieter way to lose an edit. While a request is pending,
 * a new proposal for the same record MERGES into the existing line, with the
 * assistant's fields laid over the top. Anything the user had typed into a
 * field the assistant sent again was overwritten. Both assistants did this.
 *
 * THE RULE
 * --------
 * A line the user has edited belongs to the user. An assistant may not
 * withdraw it, and may not merge over it, unless the user has said to throw
 * the edit away. The refusal hands the assistant the user's version, so it
 * builds on that instead of on its own memory of what it proposed.
 *
 * What counts as an edit: the line's ARGUMENTS changed, through
 * `updateAcrChange`. Ticking or unticking a line is not an edit. An edit the
 * user later typed back to the original values is not an edit either — there
 * is nothing left to protect.
 *
 * Both assistants go through here: the store (`createAcr`) enforces it for
 * everyone, and `bridgeClient.ts` checks it first so Claude gets a clear error
 * before anything is filed.
 */

/** The parts of a proposed line this file reads. Kept local to avoid an import cycle with the store. */
export interface EditableAcrChange {
  id: string;
  name: string;
  args: any;
  changeTitle?: string;
  /** The arguments exactly as the assistant proposed them. Kept the first time the user edits the line. */
  proposedArgs?: any;
  /** When the user last edited this line's arguments. Absent: never edited. */
  userEditedAt?: string;
}

/** JSON with object keys in a fixed order, so two equal values always compare equal. */
function stable(value: any): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

const same = (a: any, b: any) => stable(a) === stable(b);

const clone = (value: any) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * The fields the user changed on this line, compared with what the assistant
 * proposed. `changeTitle` is the line's label, not a field, and is left out.
 */
export function userEditedFields(change: EditableAcrChange | undefined | null): string[] {
  if (!change || !change.userEditedAt || !change.proposedArgs) return [];
  const now = change.args || {};
  const was = change.proposedArgs || {};
  const keys = new Set([...Object.keys(now), ...Object.keys(was)]);
  keys.delete('changeTitle');
  return [...keys].filter((k) => !same(now[k], was[k])).sort();
}

/** True when the line carries an edit of the user's that is still in force. */
export function isUserEdited(change: EditableAcrChange | undefined | null): boolean {
  return userEditedFields(change).length > 0;
}

/** The user's current values for the fields they changed. */
export function userEditedValues(change: EditableAcrChange): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of userEditedFields(change)) out[k] = change.args?.[k];
  return out;
}

/**
 * The line with new arguments from the user. The assistant's original is kept
 * the first time, and never replaced after that — a second edit is compared
 * with what the assistant proposed, not with the first edit. Writing back the
 * same arguments changes nothing and marks nothing.
 */
export function withUserEdit<T extends EditableAcrChange>(change: T, newArgs: any, at = new Date().toISOString()): T {
  if (same(newArgs, change.args)) return { ...change, args: newArgs };
  return {
    ...change,
    args: newArgs,
    proposedArgs: change.proposedArgs !== undefined ? change.proposedArgs : clone(change.args),
    userEditedAt: at,
  };
}

/**
 * The pending line a new proposal would merge into: same action, same record
 * (and the same comment, for a comment edit).
 * The same match `createAcr` uses. A proposal without an id never merges.
 */
export function findMergeTarget<T extends EditableAcrChange>(changes: T[], name: string, args: any): T | undefined {
  const id = args?.id;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  // An edit to a comment is aimed at ONE comment on the record. Two edits to
  // different comments of the same task are two lines, never one.
  const commentId = args?.commentId;
  return changes.find((c) =>
    c.name === name && c.args && c.args.id === id &&
    (commentId === undefined || c.args.commentId === commentId));
}

/**
 * What an assistant is told when it reaches for a line the user edited.
 * `values` is passed in already made safe to send (the bridge masks names).
 */
export function editedLineMessage(
  change: EditableAcrChange,
  attempted: 'withdraw' | 'merge',
  values: Record<string, any> = userEditedValues(change),
): string {
  const label = change.changeTitle ? `"${change.changeTitle}"` : `the pending ${change.name} line`;
  const fields = userEditedFields(change).join(', ');
  const what = attempted === 'withdraw'
    ? 'It was not withdrawn.'
    : 'Your new proposal for the same record was not merged into it, so the edit is intact.';
  return (
    `The user has edited ${label} (line ${change.id}) in the app — fields: ${fields}. ${what} ` +
    `The user's version of those fields: ${JSON.stringify(values)}. ` +
    'Build on the user\'s version, not on what you first proposed. If a field still needs your change, ' +
    'ask the user, or let them edit the line themselves. Withdraw it only if the user has told you to throw their edit away.'
  );
}
