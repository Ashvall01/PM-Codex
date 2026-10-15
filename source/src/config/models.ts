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

/** GA 2026-08-13. 1M in / 65,536 out. Function calling. $0.75 / $3.75 per 1M. */
const GEMINI_3_7_FLASH = 'gemini-3.7-flash';

/** Ultra-fast, reliable audio transcription workhorse with permissive audio processing. */
const GEMINI_2_5_FLASH = 'gemini-2.5-flash';

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
   * EXPERIMENT (started 2026-08-15): running the agentic loop on Flash instead
   * of Pro-preview. Rationale: 3.7 Flash is GA rather than preview, two
   * generations newer, same 1M context, and is positioned as the agentic/coding
   * workhorse. If tool selection and multi-step reasoning hold up across the
   * 30-tool surface, this is a large cost reduction.
   *
   * TO ROLL BACK: change this to GEMINI_3_1_PRO_PREVIEW. Nothing else moves.
   */
  REASONING: GEMINI_3_7_FLASH,

  /** Mechanical extraction and formatting: chat titles, meeting iteration. */
  FAST: GEMINI_2_5_FLASH,

  /** Audio speech transcription engine. */
  TRANSCRIPTION: GEMINI_2_5_FLASH,
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
 * ('minimal' is rejected by gemini-3.7-flash and gemini-3.1-pro-preview.)
 */
export const DEFAULT_THINKING_LEVEL = ThinkingLevel.LOW;
