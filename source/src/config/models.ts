import { ThinkingLevel } from '@google/genai';

/**
 * Central model configuration.
 *
 * All Gemini model IDs live here so that a model rename or a tier change is a
 * one-line edit instead of a hunt across the codebase.
 *
 * TIERING RULE:
 *   REASONING -> agentic sidebar, cross-module analysis, anything that proposes
 *                changes to project state.
 *   FAST      -> mechanical work with a fixed shape: chat titles, transcript
 *                structuring, extraction into a known schema. These do not need
 *                a frontier model and are the bulk of the token volume.
 */

/**
 * The newest Flash (stable since 2026-09-02). 1M in / 65,536 out. Text, image,
 * video, audio and PDF in. Function calling. Thinking levels low | medium |
 * high (default medium; 'minimal' is an error).
 *
 * Moved here 22 Oct 2026 from:
 *   - gemini-3.7-flash — deprecated 2026-10-08; Google routes it to 3.8 anyway.
 *   - gemini-2.5-flash — since 2026-09-18 only accounts that used it before
 *     can call it, so new public users got errors on titles, meeting
 *     structuring and transcription.
 */
const GEMINI_3_8_FLASH = 'gemini-3.8-flash';

/**
 * Stable, not deprecated, open to new accounts. Used only as the second try
 * when a meeting call is blocked or keeps failing on the main model.
 */
const GEMINI_3_6_FLASH = 'gemini-3.6-flash';

/**
 * Preview model. Google shut down its predecessor `gemini-3-pro-preview` on
 * 2026-03-09, so assume this one eventually follows. Kept here as the rollback
 * target for the REASONING experiment below.
 */
const GEMINI_3_1_PRO_PREVIEW = 'gemini-3.1-pro-preview';

export const MODELS = {
  /**
   * Agentic sidebar, cross-module analysis, anything proposing state changes.
   *
   * EXPERIMENT (started 2026-08-15 on 3.7 Flash, now 3.8 Flash): running the
   * agentic loop on Flash instead of Pro-preview. Rationale: Flash is GA rather
   * than preview, newer, same 1M context, and is positioned as the
   * agentic/coding workhorse. If tool selection and multi-step reasoning hold up across the
   * 30-tool surface, this is a large cost reduction.
   *
   * TO ROLL BACK: change this to GEMINI_3_1_PRO_PREVIEW. Nothing else moves.
   */
  REASONING: GEMINI_3_8_FLASH,

  /** Mechanical extraction and formatting: chat titles, meeting iteration. Thinking LOW. */
  FAST: GEMINI_3_8_FLASH,

  /** Audio speech transcription engine. Thinking LOW, so thinking does not eat the output limit. */
  TRANSCRIPTION: GEMINI_3_8_FLASH,

  /** Second try for meeting calls (safety false positive, repeated failure). */
  FALLBACK: GEMINI_3_6_FLASH,
} as const;

/**
 * Default deliberation depth for the sidebar.
 *
 * Gemini 3 models control thinking with named LEVELS, not token budgets. The
 * old `thinkingBudget` token count is not part of the current API surface.
 *
 * Most project work is mechanical (edit a date, update a status) and is well
 * served by LOW. Escalate per-conversation from the THINKING ENGINE selector
 * when a task genuinely needs analysis.
 *
 * Supported on both models above: low | medium | high.
 * ('minimal' is rejected by gemini-3.8-flash and gemini-3.1-pro-preview.)
 */
export const DEFAULT_THINKING_LEVEL = ThinkingLevel.LOW;
