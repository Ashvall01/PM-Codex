# Project Custom Rules & Design Guidelines

## UI & Aesthetics (Quantum Break Inspired)
- **Theme**: Clean, geometric, high-contrast, minimalist UI inspired by the game Quantum Break.
- **Typography**: 
  - Primary font: `Montserrat` (use extensively with uppercase, `tracking-widest`, and bold weights for UI text).
  - Secondary/Mono font: `JetBrains Mono` for technical data, numbers, or identifiers.
- **Color Palette**:
  - Background: `#f5f6f6` (`bg-qb-bg`)
  - Black/Text: `#111111` (`text-qb-black`)
  - Dark Grey: `#5c666b` (`text-qb-dark-grey`)
  - Grey: `#8c9699` (`text-qb-grey`)
  - Light Grey: `#d1d5db` (`border-qb-light-grey`)
  - Accents: Orange (`#ff7600`), Magenta (`#c11c4d`), Cyan (`#2dbcd2`), Green (`#51b53e`)
- **Layout Components**:
  - Navigation: Sleek, horizontal scrolling top nav bar with active states marked by solid accent lines.
  - Panels: Sharp corners, distinct borders, and structural layouts rather than floating soft-shadow cards.

## Animation (GSAP)
- Use `gsap` and `@gsap/react` for all major UI animations.
- Prefer smooth staggered entrance animations for lists, data items, and page loads (`ease: 'power3.out'`).
- Use timeline/progress bar scaling from left (`transformOrigin: 'left center'`).
- Ensure elements animate gracefully as they enter the DOM.

## The Gemini key never goes into the page

The app runs on the user's own computer. The Gemini API key lives only in the
local server (`server.mjs`), which reads it from Pinokio's settings and adds it
to each call. The page holds a placeholder.

- Make every Gemini call through `src/services/geminiClient.ts` (`gemini`).
  Never write `new GoogleGenAI({ apiKey: ... })` with a real key.
- Never add a `define` (or any other build-time setting) that reads an API key
  into `vite.config.ts`. Pinokio puts the key in the environment of every
  script, so it would be baked into the built page. `server.mjs` refuses to
  start if it finds the key in the build.
- Gemini is optional. Show a failed call with `geminiErrorText(err)`; without a
  key the server's answer is already a plain sentence telling the user what to do.

## Files you must not modify

This applies to any coding agent working on this repository.

`src/services/bridgeClient.ts` is maintained together with the bridge in the
project's `bridge/` folder. It connects the running tab to a local bridge so Claude can inspect the
project and file change requests into it for the user to approve.

- Do not edit it, reformat it, refactor it, or "clean it up".
- Do not remove `import './services/bridgeClient';` from `App.tsx`. Deleting that one line silently
  disconnects the bridge, and the app gives no sign that anything is wrong.
- Its only write is a proposal into `acrStore`. It touches no project record and calls no network
  service other than `ws://127.0.0.1:7799`. It is not a candidate for removal as dead code.

`src/services/fieldSchema.ts` is the same kind of file, for the same reason: it is what
`bridgeClient.ts` calls to answer Claude's `get_field_schema` tool, so it is maintained
alongside it rather than as ordinary app code. Do not edit it, reformat it, or "clean up" its
runtime copies of each store's enum values — they exist because a TypeScript `type`
disappears at compile time, so the exact spelling a proposal must match has to live
somewhere a running process can read it.

If a change genuinely needs to touch it, say so and stop. Do not make the change.

## Two small things elsewhere that the bridge depends on

These live in files this agent does own. They are three lines in total. Leave them alone.

1. **`origin` on the change request.** `src/store/acrStore.ts` carries an `origin` field
   (`'gemini' | 'claude'`) on `AssistantChangeRequest`, and `createAcr` takes it as a fourth
   argument that defaults to `'gemini'`. It records which assistant proposed the request. Do not
   remove it, and do not change the default.

2. **The origin guard in `src/components/layout/AISidebar.tsx`.** `handleDecideAcr` (every
   sign-off from the review panel: all, selected, a group or one line) returns early when the
   request's origin is `'claude'`, before building the feedback message. Without it, signing off a proposal Claude made sends Gemini a message about
   work Gemini never did, and Gemini answers with something confused. The guard reads the field
   defensively and needs no import, so it is safe to keep through a rewrite.

3. **The session filter on the review panel in `src/components/layout/AISidebar.tsx`.**
   `activeAcr` matches on the session id as well as the request id, and lets a request whose origin
   is `'claude'` through regardless. It also matches on the project: a request is reviewed in the
   project it belongs to. Without the session test, one open request appears in every
   chat, old conversations included. Without the `'claude'` exemption, a request from the bridge
   becomes unreachable, because it belongs to no chat.

4. **`ClaudeProposalBar` in `src/components/layout/AppLayout.tsx`.**
   The only way to reach a change request the bridge filed — in the open project, and (since
   22 Oct 2026) in any other project, which it links to. Deleting it does not break the build; it
   makes those requests invisible, with nothing to say so.

Everything else in `AISidebar.tsx`, `AppLayout.tsx` and `acrStore.ts` is yours.

## How a proposed change is shown — one rule, all modules

A pending change request must be visible **everywhere it applies**, and it must
be clear what the value was and what it becomes. Three files carry that, and
they are ordinary app files you own:

- `src/utils/acrDiff.ts` — works out what a proposal changes.
- `src/components/AcrDiffList.tsx` — draws OLD above NEW.
- `src/utils/acrRecordLookup.ts` — finds the record a proposal points at.

**Do not go back to writing per-field comparison lines inside a module.** Each
module used to carry its own list of `hasOwnerDiff`, `hasStatusDiff` and so on.
Every field somebody forgot to add to that list was applied on sign-off without
ever appearing on the screen, and each module had drifted into a different
answer for what the list row should show. The shared helper derives the
comparison from the proposal itself, so a field cannot be left out by
forgetting. Adding a field to a store or a tool needs no change here at all.

The shape every module follows:

1. Build the list with `enrichWithAcr(...)`. Rows come back holding the
   **proposed** values, plus `acrOriginal`, `acrDiffs` and `acrChange`.
2. Mark the row: green for new, orange for an edit (with the count of changed
   fields), magenta for a removal, cyan for a comment. Same words everywhere.
3. In the detail panel, give each field `{...acrFieldProps(item, 'fieldName')}`
   so the field itself shows its old value above its new one, and end with an
   `<AcrDiffList/>` of `acrUnshownDiffs(item, SHOWN_FIELDS)` — the safety net for
   anything the panel does not draw itself.

   **Do not add a summary banner above the fields.** One existed and was
   removed: it repeated the change title and then listed every changed field a
   second time, directly above the fields that already showed the same thing.
   The only exception is `<AcrStatusLine/>`, one line, for a proposed **removal**
   — a removal changes no field, so nothing else on the screen can show it — and
   for a panel built from plain input boxes rather than `EditableField`, where a
   line has to say that a save lands on the proposal.
4. An edit made while a proposal is open must be written to the **proposal**,
   never to the record. Check `isAcrProposedAdd || isAcrProposedUpdate` first.

`test/acr-diff.mjs` checks the helper. Run it if you touch any of these three.

## A pending line the user edited is theirs — `src/utils/acrUserEdits.ts`

The user can edit any line of a pending change request before signing off.
`updateAcrChange` in `acrStore.ts` records it: the assistant's original stays
in `proposedArgs`, and `userEditedAt` marks the line. `createAcr` then refuses
to withdraw that line or merge a new proposal over it, for both assistants,
unless the call carries `discardUserEdit: true`. On 30 Sep a user's edit was
lost for good because none of this existed.

- Every edit to a proposal must go through `updateAcrChange`. Writing a
  change's `args` any other way skips the record, and the edit is unprotected.
- Do not make the tick box (`updateAcrChangeApproval`) count as an edit.
- Gemini's sidebar answers each refusal from `takeAcrMergeRefusals()` right
  after `createAcr`. Keep that, or Gemini is told a refused call succeeded.

`test/run-acr-edit-guard-test.mjs` checks all of it. Run it if you touch any
of the above.

## Carrying out an approved change — one executor, no copies

`src/services/acrExecutor.ts` is the only place a proposed change is applied.
Two callers use it: Gemini's review modal, and `src/services/acrSignOff.ts`,
which every sign-off button goes through (the review panel's footer, a group,
one line, and the APPROVE / REJECT on Gemini's card in the chat).

## Signing off part of a request — `src/services/acrSignOff.ts`

Since 22 Oct 2026 the user approves or rejects lines — all, the ticked ones, a
group, or one — and the rest stay open. `signOffAcrLines` applies the lines
(against the REQUEST's project, `acr.projectId`, never the open one) and
`decideAcrChanges` moves them from `changes` to `decided`. So `changes` is
always the open lines, and every module that draws a pending request keeps
working unchanged. A request closes when its last open line is decided.

- An unticked line is **not declined**: it stays open. Do not strike it
  through or call it "declined" anywhere.
- Do not call `setAcrStatus` to sign off. It skips the executor and the
  `decided` bookkeeping the bridge reports from.
- `createAcr` matches an open request on session, origin AND project. Claude
  files every request under one session id; without the project, a proposal
  for a second project was folded into the first one's request.
- `group` on a line is the heading the assistant gave it (`changeGroup` in the
  arguments, lifted out by `takeChangeGroup`). `utils/acrGroups.ts` sorts lines
  into sections for the panel.

**Do not put an action's code back inside `AISidebar.tsx`.** That code existed
three times over until 8 Sep, and every difference between the copies was a
fault: a deliverable got a status the app does not have, a task got a type that
is not a task type, and three actions did nothing at all when approved from the
review panel because only one copy handled them. A single argument-name bug had
to be fixed in three places, with nothing to tell you when you had fixed two.

To add an action: add a `case` to `applyProjectChange`, and add its name to
`APPLICABLE_ACTIONS` in `src/services/bridgeClient.ts` — which you must not edit
otherwise. Letting a name through there is a promise that the button will
honour it. Also register it in `ACR_ACTIONS` (`src/utils/acrDiff.ts`) so the
review panel names it, and give Gemini a declaration in `AISidebar.tsx`.
Updates go through `contentOnly(args)`, so a proposal's `changeTitle` is never
written into the record.

`test/run-executor-test.mjs` drives the real stores through it. Run it if you
touch the executor.

## Adding an action the assistants can propose — the tables to touch

The archive, comment edits and flags (6 Oct 2026) each needed the same short list. Miss one and nothing
fails loudly — the action is refused, or approved and not shown, or shown with no old value.

1. `acrExecutor.ts` — a `case`, and an archived-record refusal (`refuseIf…Archived`) where the record
   can be archived.
2. `acrDiff.ts` — `ACR_ACTIONS` (kind and module), and `ACR_IMPLIED_ARGS` when the name says it all
   (`archive…`, `flag…`). A `commentId` is a routing key, not a field.
3. `acrStore.ts` — `getChangeTitle` for a readable title.
4. `bridgeClient.ts` (maintained with the bridge, so keep the edits to these tables): `APPLICABLE_ACTIONS`,
   `RECORD_TARGETS` (so a change aimed at a missing record is refused), `ARCHIVED_EDIT_GUARDS`, and for a
   comment edit the `COMMENT_EDITS` check.
5. `AISidebar.tsx` — a declaration for Gemini, listed in the tool array, and `getModulePathForTool` for an
   unarchive action. `useAIContextString.ts` — the sentence telling Gemini about it.
6. The module screen — add the action to its `enrichWithAcr` lists (`update` or `comment`), so the row and
   tray show the proposal. Comments are drawn by `components/ProposedCommentCard.tsx` in every module.
7. `bridge/server.mjs` text and `bridge/directive.md` for Claude; the tests in `test/` for each of the above.

A new archivable module is the archive checklist in `utils/archive.ts` plus `ARCHIVE_READERS` and
`ARCHIVE_RESTORE_ACTION` in `aiContextEngine.ts`, the route in `App.tsx`, `ArchiveTabs`/`ArchiveButton` on
its screen, and the counts that must leave archived records out (`projectHealth.ts` for risks).

## Meeting action items belong to the meeting

An action agreed in a meeting lives in the `actionItems` of its minutes, and
nowhere else. **Signing off does not push anything to the task tracker** (the
automatic push was removed on 23 Sep 2026 at the user's request). The user
pushes from the MoM screen: the push button on one item, or PUSH ALL. Both go
through `pushActionItemsToTracker` in `src/services/momActionPush.ts`, which
creates the task and writes its id back onto the action item — that id is the
link. A click on an action item never creates a task: a pushed item opens its
task, any other item opens the editor.

A proposed MoM's action items often arrive without ids. `proposalActionItems`
in `Mom.tsx` gives each one a stable id, and both the screen and the edit
handlers use it — if they disagree, every edit to the item is silently lost.

**Never make a meeting action a separate `addTask` as well.** That is a second,
unlinked record of one thing, and the user then has two to keep in step. Both
standing briefs say so — `bridge/directive.md` and `STABLE_DIRECTIVES` in
`src/hooks/useAIContextString.ts`. Keep the two in agreement.

The action item carries the task's fields — priority, due date, remarks, linked
activities. `importMom` in `src/store/momStore.ts` must keep copying them, or
the task lands bare when the user pushes it. The MoM screen shows these fields
under each item (DETAILS, collapsed by default) in view and edit mode, so a
proposal never carries a value the user cannot see; for a pushed item they are
read from and saved to the linked task.

## Saving to the Sheet — a save counts only when the Sheet says so

`gasSyncService.syncNow` resolves `true` only when the Apps Script answered
that the write succeeded (not HTTP OK alone: the script answers errors with
`{status:'error'}`, and a sign-in page comes back as HTML). A job is marked
COMPLETED only then. Saves run one at a time (`pushInFlight`), because each
one wipes and rewrites every sheet. Do not call `fetch` to the Sheet from
anywhere else, and do not mark queue jobs COMPLETED on your own.

Sheets coerces cell values. `sanitizePayload` sends dates (`YYYY-MM-DD`) and
times (`HH:MM`) with a leading apostrophe so they stay text; the load path
strips it. A cell that starts with `[` or `{` comes back already parsed — read
lists and objects in both forms. `test/run-sync-test.mjs` covers all of this.

## The Codex has two levels — `src/utils/codexRules.ts`

A folder is a Codex record with no parent. It holds pages and has **no
content**; the screen never draws a folder's content. A page always sits in a
folder; pages never hold pages. `checkCodexChange` refuses a proposal that
breaks this (both assistants, before it is filed) and the executor refuses it
again at sign-off. Never write content onto a folder, and never give a page a
page as its parent. Old data that breaks the rule is shown, not hidden: notes
on a folder appear as "Folder notes", pages without a folder under UNFILED.

## Ids from the assistants are aliases

The assistants see aliases (CDX4, ACT12, STK3), never real ids. Every id they
send — `parentId`, `linkedActivityIds`, `reportsToIds`, not only `id` — must be
translated before it is stored: `replaceAliasWithReal` (which handles arrays of
strings) does it for Gemini in `AISidebar.tsx` and for Claude in
`bridgeClient.ts`. `utils/aliasRepair.ts` repairs saved references once per
load. A new id-carrying argument needs nothing extra, as long as it goes
through one of those two paths.

## Deleting a whole project — `src/services/projectRemoval.ts` only

Backup first, then `deleteProjectEverywhere`, which also tells the save guard
which rows to expect (`gasSyncService.expectRowRemovals`) and marks the project
deleted so a load cannot bring it back. Never remove a project's records from
the stores any other way. `restoreProjectBackup` is the way back.

## Rich text has one look — `.qb-prose` in `src/index.css`

Codex pages, MoM sections and both editors take their colours from `.qb-prose`
(`RichTextViewer` adds it). Do not add `prose-p:text-…` or `prose-slate`
classes per page: paragraphs then differ from lists, bold and headings, which is
the "sometimes black, sometimes grey" the user reported.

## Search — `src/utils/recordSearch.ts`

Tasks and Deliverables share one search engine and `components/SearchBox.tsx`.
Reuse them for any other list; lists may arrive as JSON text, so read them with
`asList`.

## One colour language — `src/utils/statusStyle.ts`

Status, priority and due-date colours come from that one file: green done,
cyan in progress, orange waiting on someone or due soon, magenta blocked,
late or high, grey paused. Use its tables and `tint()` for chip backgrounds —
never `${cssVar}20`, which is not a colour. Do not add a module-local colour
table.

## Module tops and project numbers

Every module opens with `<PageHeader>` (`src/components/PageHeader.tsx`):
title, a few live counts (`<Stat/>`, coloured only when non-zero and
needing attention), controls on the right. No 36px titles, no descriptive
subtitles. Text is never smaller than 9px (10px in the Gantt).

"Late", "due this week", "high risk" and schedule % come from
`buildProjectPicture` in `src/utils/projectHealth.ts` — the Overview, the
project list and the Risks heat map all read it. Do not count them again in a
module.

## PII marks while typing — keep them cheap

`PIISuggestionOverlay` checks the text box being typed in; `PIIGlobalHighlighter`
marks the rest of the page. Both react to the user's typing or to any change on
the page, so both must stay cheap:

- Check when typing pauses, never on every key press. The matching lives in
  `src/utils/piiMatcher.ts`; `test/run-pii-matcher-test.mjs` proves it gives the
  same answers as the old check, and times it.
- In a contentEditable, paint with the CSS Custom Highlight API
  (`::highlight(pii-suggest)`), not with boxes on top — boxes drift out of the
  editor and trail behind scrolling.
- The global highlighter ignores changes inside editors, inputs and the overlay.
