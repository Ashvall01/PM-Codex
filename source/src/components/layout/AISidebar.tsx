import React, { useRef, useState, useEffect } from "react";
import {
  X,
  Send,
  Check,
  X as XIcon,
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  Terminal,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Paperclip,
  Image,
  Music,
  Video,
  FileText,
  Sparkles,
  ArrowRight,
  Settings as SettingsIcon,
  Search,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { GeminiIcon } from "../icons/GeminiIcon";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  Type,
  FunctionDeclaration,
  Content,
  FunctionCall,
  ThinkingLevel,
} from "@google/genai";
import { MODELS, DEFAULT_THINKING_LEVEL } from "../../config/models";
import { gemini, geminiErrorText, isGeminiKeyMissing } from "../../services/geminiClient";
import { useTimelineStore } from "../../store/timelineStore";
import { useAppStore } from "../../store/appStore";
import { useCodexStore } from "../../store/codexStore";
import { useAiStore } from "../../store/aiStore";
import { usePromptTemplatesStore, PromptTemplate, TemplateCategory } from "../../store/promptTemplatesStore";
import { getCategoryBadgeColor } from "../../features/Settings/PromptTemplatesTab";
import { useDeliverablesStore } from "../../store/deliverablesStore";
import { useRisksStore } from "../../store/risksStore";
import { useTasksStore } from "../../store/tasksStore";
import { useMomStore } from "../../store/momStore";
import { useMeetingsStore } from "../../store/meetingsStore";
import { useStakeholdersStore } from "../../store/stakeholdersStore";
import { useDocumentsStore } from "../../store/documentsStore";
import { useBillingStore } from "../../store/billingStore";
import { useAcrStore, takeAcrMergeRefusals } from "../../store/acrStore";
import { useIdAliasStore } from "../../store/idAliasStore";
import { readArchivedModule } from "../../services/aiContextEngine";
import { buildAIContextString } from "../../hooks/useAIContextString";
import { useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { AIResponseRenderer } from "./AIResponseRenderer";
import { AIExecutionChain } from "./AIExecutionChain";
import { AIAvatar } from "./AIAvatar";
import { ConfirmationDialog } from "../ConfirmationDialog";
import AIReviewModal from "./AIReviewModal";
import { acrKindStyle } from "../AcrDiffList";
import { applyProjectChange } from "../../services/acrExecutor";
import {
  diffsForChange,
  getAcrActionSpec,
  formatAcrValue,
} from "../../utils/acrDiff";
import {
  findAcrTargetRecord,
  describeAcrTargetRecord,
} from "../../utils/acrRecordLookup";
import {
  sanitizeContentHistory,
  sanitizeString,
  reconstructParts,
} from "../../utils/piiSanitization";
import { usePIIStore } from "../../store/piiStore";
import { checkCodexChange, isCodexFolder } from "../../utils/codexRules";
// mammoth, xlsx and jszip read attached Word, Excel and PowerPoint files. They
// are loaded when a file is attached, not with the app: together they were a
// large share of the start-up download for something most sessions never use.

gsap.registerPlugin(useGSAP);

// Gemini goes through the local key server — see services/geminiClient.ts.
const ai = gemini;

const addTimelineRowDecl: FunctionDeclaration = {
  name: "addTimelineRow",
  description:
    "Add a new row/activity to the timeline. Can specify an optional baseline/revision ID. Any field may be a formula: a value starting with \"=\", e.g. targetCompletionDate \"=WORKDAY([Target Start], 10)\". WORKDAY and NETWORKDAYS skip weekends and the project's holidays.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      revisionId: {
        type: Type.STRING,
        description:
          "Optional ID of the timeline revision to add to. Defaults to the active revision.",
      },
      insertAfterId: {
        type: Type.STRING,
        description:
          "Optional ID of the activity after which to insert the new row. If not provided, it is added at the end.",
      },
      phase: { type: Type.STRING },
      activity: { type: Type.STRING },
      subActivity: { type: Type.STRING },
      weight: { type: Type.NUMBER },
      progress: { type: Type.NUMBER },
      status: {
        type: Type.STRING,
        description:
          "Must be one of: Completed, Completed With Delay, Work In Progress, Delayed WIP, Not Started, Planned, Backlog, Dropped, On Hold",
      },
      owner: { type: Type.STRING },
      targetStartDate: { type: Type.STRING, description: "YYYY-MM-DD" },
      targetCompletionDate: { type: Type.STRING, description: "YYYY-MM-DD" },
      actualStartDate: { type: Type.STRING, description: "YYYY-MM-DD" },
      actualCompletionDate: { type: Type.STRING, description: "YYYY-MM-DD" },
      remarks: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Specify what is being created. Example: "Created Activity: Kickoff meeting (General)"',
      },
    },
    required: ["phase", "activity", "status"],
  },
};

const discardPendingACRChangeDecl: FunctionDeclaration = {
  name: "discardPendingACRChange",
  description:
    "Discard a specific proposed change from the currently pending Assistant Change Request (ACR). Use this when the user asks you to remove or cancel a change you previously proposed. A line the user has edited in the app is theirs: it is refused unless discardUserEdit is true, which you set only when the user has told you to throw their edit away.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      changeId: {
        type: Type.STRING,
        description: "The ID of the ACR change to discard.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive title for the action. Example: "Discarded proposed update for row X"',
      },
      discardUserEdit: {
        type: Type.BOOLEAN,
        description:
          "Only when the user has told you to throw away their own edit to this line. Without it, a line the user edited is kept.",
      },
    },
    required: ["changeId"],
  },
};

const updateTimelineRowDecl: FunctionDeclaration = {
  name: "updateTimelineRow",
  description:
    "Update an existing row/activity in the timeline. Use this to change any fields. A value starting with \"=\" becomes a formula (e.g. \"=WORKDAY([Target Start], 5)\"); a plain value replaces a formula, as in Excel. Refs: Excel style (H3) or this row's columns by name ([Target Start], [Target End], [Actual Start], [Actual End], [Prog %]).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      revisionId: {
        type: Type.STRING,
        description:
          "Optional ID of the timeline revision to update in. Defaults to the active revision.",
      },
      id: {
        type: Type.STRING,
        description: "The unique ID of the activity to update.",
      },
      phase: { type: Type.STRING },
      activity: { type: Type.STRING },
      subActivity: { type: Type.STRING },
      weight: { type: Type.NUMBER },
      progress: { type: Type.NUMBER },
      status: { type: Type.STRING },
      owner: { type: Type.STRING },
      targetStartDate: { type: Type.STRING },
      targetCompletionDate: { type: Type.STRING },
      actualStartDate: { type: Type.STRING },
      actualCompletionDate: { type: Type.STRING },
      remarks: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing what fields were modified and what the from/to values are. Example: "Expedited the UAT Signoff from 16 Jun 2026 to 13 Jun 2026" or "Updated progress of Integration Testing to 85%"',
      },
    },
    required: ["id"],
  },
};

const deleteTimelineRowDecl: FunctionDeclaration = {
  name: "deleteTimelineRow",
  description: "Delete a row/activity from the timeline.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      revisionId: {
        type: Type.STRING,
        description:
          "Optional ID of the timeline revision to delete from. Defaults to the active revision.",
      },
      id: {
        type: Type.STRING,
        description: "The unique ID of the activity to delete.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing what activity is being deleted. Example: "Deleted Activity: Requirements gathering"',
      },
    },
    required: ["id"],
  },
};

const reorderTimelineRowDecl: FunctionDeclaration = {
  name: "reorderTimelineRow",
  description:
    "Reorder a timeline activity row by shifting it from one index to another within a revision.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      revisionId: {
        type: Type.STRING,
        description:
          "Optional ID of the timeline revision. Defaults to the active revision.",
      },
      startIndex: {
        type: Type.NUMBER,
        description: "The current index of the activity to move.",
      },
      endIndex: {
        type: Type.NUMBER,
        description: "The target index to move the activity to.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Reordered requirements elicitation activity to index 3"',
      },
    },
    required: ["startIndex", "endIndex"],
  },
};

const createTimelineBaselineDecl: FunctionDeclaration = {
  name: "createTimelineBaseline",
  description:
    "Create a new timeline baseline (revision) from the current or a specific baseline.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "The name of the new baseline." },
      baseRevisionId: {
        type: Type.STRING,
        description:
          "Optional. The ID of the baseline to copy from. If not specified, copies from the currently active baseline.",
      },
    },
    required: ["name"],
  },
};

const setTimelineHolidaysDecl: FunctionDeclaration = {
  name: "setTimelineHolidays",
  description:
    "Replace the project's holiday list (days off that WORKDAY and NETWORKDAYS skip, besides weekends). Send the WHOLE list: every date already in the list that should stay, plus the new ones. The project state lists the current holidays.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      holidays: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Every holiday, YYYY-MM-DD.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A descriptive change title. Example: "Added Independence Day (17 Aug 2026) to the project holidays"',
      },
    },
    required: ["holidays"],
  },
};

const createCodexFolderDecl: FunctionDeclaration = {
  name: "createCodexFolder",
  description:
    "Create an empty Codex folder. A folder holds pages and has no content of its own. To create a folder and a page in one go, call createCodexPage with folder set to the new folder's title instead.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description: 'A descriptive change title. Example: "Created Codex folder: MEETING NOTES"',
      },
    },
    required: ["title"],
  },
};

const createCodexPageDecl: FunctionDeclaration = {
  name: "createCodexPage",
  description:
    "Create a new Codex page to store project information, procedures, or notes. The Codex has two levels: folders hold pages, and a page always sits in a folder. Pages cannot hold pages, and folders have no content.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      content: { type: Type.STRING },
      parentId: {
        type: Type.STRING,
        description: "ID of the FOLDER the page goes into. Send this or folder.",
      },
      folder: {
        type: Type.STRING,
        description: "Title of the folder the page goes into, instead of parentId. A title no folder has yet creates that folder.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Created Codex Page: UAT Guidelines"',
      },
    },
    required: ["title", "content"],
  },
};

const updateCodexPageDecl: FunctionDeclaration = {
  name: "updateCodexPage",
  description: "Update the title or content of an existing Codex page, rename a folder, or move a page to another folder (parentId). A folder has no content: never send content for a folder.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "The unique ID of the codex page or folder to update.",
      },
      title: { type: Type.STRING },
      content: { type: Type.STRING },
      parentId: {
        type: Type.STRING,
        description: "Optional. Move the page into this folder.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Updated Codex Page content of Release Plan"',
      },
    },
    required: ["id"],
  },
};

const addDeliverableDecl: FunctionDeclaration = {
  name: "addDeliverable",
  description: "Add a new deliverable to the project.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      definitionOfDone: { type: Type.STRING },
      status: {
        type: Type.STRING,
        description:
          "Must be one of: Pending, In Progress, On Hold, In Review, Signed Off, Dropped, Blocked",
      },
      dueDate: { type: Type.STRING, description: "YYYY-MM-DD" },
      category: { type: Type.STRING },
      priority: { type: Type.STRING, description: "Low, Medium, High" },
      owner: { type: Type.STRING, description: "Owner or person responsible for this deliverable." },
      parentId: {
        type: Type.STRING,
        description: "Optional parent deliverable ID if creating this sub-deliverable inside a nested deliverables space.",
      },
      hasNestedSpace: {
        type: Type.BOOLEAN,
        description: "Whether this deliverable has a dedicated nested deliverables space enabled.",
      },
      linkedActivityIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Optional list of timeline activity IDs linked to this deliverable.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Created Deliverable: Test Strategy Document (Due 25 Jun, Owner: Sarah)"',
      },
    },
    required: ["title", "status", "dueDate"],
  },
};

const updateDeliverableDecl: FunctionDeclaration = {
  name: "updateDeliverable",
  description: "Update an existing deliverable.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "The unique ID of the deliverable.",
      },
      title: { type: Type.STRING },
      description: { type: Type.STRING },
      definitionOfDone: { type: Type.STRING },
      status: { type: Type.STRING },
      dueDate: { type: Type.STRING },
      category: { type: Type.STRING },
      priority: { type: Type.STRING },
      owner: { type: Type.STRING, description: "Owner or person responsible for this deliverable." },
      parentId: {
        type: Type.STRING,
        description: "Parent deliverable ID if nested inside another deliverable space.",
      },
      hasNestedSpace: {
        type: Type.BOOLEAN,
        description: "Whether this deliverable has an active nested deliverables space.",
      },
      linkedActivityIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Optional list of timeline activity IDs linked to this deliverable.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing the exact changes. Example: "Assigned Test Strategy deliverable to Alex" or "Deferred UAT Phase II due date to 30 Jul"',
      },
    },
    required: ["id"],
  },
};

const deleteDeliverableDecl: FunctionDeclaration = {
  name: "deleteDeliverable",
  description: "Delete a deliverable.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Deleted Deliverable: Draft Architecture Document"',
      },
    },
    required: ["id"],
  },
};

const addTaskDecl: FunctionDeclaration = {
  name: "addTask",
  description:
    "Add a new task or action item. NOT for an action agreed in a meeting — put those in the `actionItems` of createMoM or updateMom instead, and the tracker fills itself on sign-off with the task linked back to the minutes. Using this tool as well makes a second, unlinked copy of the same action.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      type: { type: Type.STRING, description: "Must be Action Item or Issue" },
      description: { type: Type.STRING },
      status: {
        type: Type.STRING,
        description: "Must be Open, In Progress, On Hold, Done, or Dropped",
      },
      owner: { type: Type.STRING },
      remarks: { type: Type.STRING },
      estimatedResolutionDate: { type: Type.STRING, description: "YYYY-MM-DD" },
      source: { type: Type.STRING },
      priority: { type: Type.STRING, description: "Low, Medium, High" },
      linkedActivityIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Optional list of timeline activity IDs linked to this task.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Created Action Item: Follow up on environment setup"',
      },
    },
    required: ["type", "description", "status"],
  },
};

const updateTaskDecl: FunctionDeclaration = {
  name: "updateTask",
  description: "Update an existing task.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      type: { type: Type.STRING },
      description: { type: Type.STRING },
      status: { type: Type.STRING },
      owner: { type: Type.STRING },
      remarks: { type: Type.STRING },
      estimatedResolutionDate: { type: Type.STRING },
      source: { type: Type.STRING },
      priority: { type: Type.STRING },
      linkedActivityIds: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Optional list of timeline activity IDs linked to this task.",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing the details changed. Example: "Completed task: Fix database leak" or "Assigned environment setup task to Peter"',
      },
    },
    required: ["id"],
  },
};

const deleteTaskDecl: FunctionDeclaration = {
  name: "deleteTask",
  description: "Delete a task.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Deleted Task: Setup legacy server"',
      },
    },
    required: ["id"],
  },
};

const addTaskCommentDecl: FunctionDeclaration = {
  name: "addTaskComment",
  description: "Add a comment to an existing task.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING },
      text: { type: Type.STRING },
    },
    required: ["taskId", "text"],
  },
};

const editTaskCommentDecl: FunctionDeclaration = {
  name: "editTaskComment",
  description:
    "Change the text of a comment that is already on a task. Read the task with getTaskDetails first: each comment there has an id, and the id of the comment you mean goes in commentId. Sends the WHOLE new text, not a patch. Works on any comment, the user's included; the user sees the old text beside the new one and signs off. To add a comment instead, use addTaskComment.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      taskId: { type: Type.STRING },
      commentId: { type: Type.STRING, description: "The id of the comment, from getTaskDetails." },
      text: { type: Type.STRING, description: "The complete new text of the comment." },
    },
    required: ["taskId", "commentId", "text"],
  },
};

const flagTaskDecl: FunctionDeclaration = {
  name: "flagTask",
  description:
    "Flag a task or issue so it stands out in the user's list. Use it for work that needs the user's attention. Check the task's isFlagged first: flagging one that is already flagged changes nothing. An archived task is read-only: restore it first.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description: 'A highly descriptive change title. Example: "Flagged task: Confirm go-live date with the vendor"',
      },
    },
    required: ["id"],
  },
};

const unflagTaskDecl: FunctionDeclaration = {
  name: "unflagTask",
  description: "Remove the flag from a flagged task or issue.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description: 'A highly descriptive change title. Example: "Removed flag: Confirm go-live date with the vendor"',
      },
    },
    required: ["id"],
  },
};

const archiveProjectRiskDecl: FunctionDeclaration = {
  name: "archiveProjectRisk",
  description:
    "Put a risk in the archive. It leaves the active list, the heat map, the counts and the project snapshot, and it stops appearing in search. Nothing is deleted and it can be restored at any time with unarchiveProjectRisk. Any status may be archived. Use it for risks that no longer need to be in front of the user, such as a mitigated risk that is settled. An archived risk is READ-ONLY: never propose updateProjectRisk on one.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description: 'A highly descriptive change title. Example: "Archived settled risk: Vendor SLA gap"',
      },
    },
    required: ["id"],
  },
};

const unarchiveProjectRiskDecl: FunctionDeclaration = {
  name: "unarchiveProjectRisk",
  description:
    "Take a risk back out of the archive and return it to the active list. Propose this FIRST when the user wants to change something that is archived — an archived risk cannot be edited in place.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description: 'A highly descriptive change title. Example: "Restored risk from archive: Vendor SLA gap"',
      },
    },
    required: ["id"],
  },
};

const editDeliverableCommentDecl: FunctionDeclaration = {
  name: "editDeliverableComment",
  description:
    "Change the text of a comment that is already on a deliverable. Read the deliverable with getDeliverableDetails first: each comment there has an id, and the id of the comment you mean goes in commentId. Sends the WHOLE new text, not a patch. Works on any comment, the user's included; the user sees the old text beside the new one and signs off. To add a comment instead, use addDeliverableComment.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      deliverableId: { type: Type.STRING },
      commentId: { type: Type.STRING, description: "The id of the comment, from getDeliverableDetails." },
      text: { type: Type.STRING, description: "The complete new text of the comment." },
    },
    required: ["deliverableId", "commentId", "text"],
  },
};

const archiveTaskDecl: FunctionDeclaration = {
  name: "archiveTask",
  description:
    "Put a task or issue in the archive. It leaves the active list and the project snapshot, and it stops appearing in search. Nothing is deleted and it can be restored at any time with unarchiveTask. Use this for finished or abandoned work the user wants off the board but on the record. An archived task is READ-ONLY: never propose updateTask or addTaskComment on one.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Archived 14 closed items from the 2025 rollout"',
      },
    },
    required: ["id"],
  },
};

const unarchiveTaskDecl: FunctionDeclaration = {
  name: "unarchiveTask",
  description:
    "Take a task or issue back out of the archive and return it to the active list. Propose this FIRST when the user wants to change something that is archived — an archived record cannot be edited in place.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Restored task from archive: Migrate the staging database"',
      },
    },
    required: ["id"],
  },
};

const archiveDeliverableDecl: FunctionDeclaration = {
  name: "archiveDeliverable",
  description:
    "Put a deliverable in the archive. It leaves the active list and the project snapshot, and it stops appearing in search. Nothing is deleted and it can be restored at any time with unarchiveDeliverable. IMPORTANT: a deliverable archives together with every sub-deliverable nested beneath it — one call can move several records, and they come back together too. An archived deliverable is READ-ONLY: never propose updateDeliverable or addDeliverableComment on one.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Archived the signed-off Phase 1 FSD deliverables"',
      },
    },
    required: ["id"],
  },
};

const unarchiveDeliverableDecl: FunctionDeclaration = {
  name: "unarchiveDeliverable",
  description:
    "Take a deliverable back out of the archive and return it to the active list, together with every sub-deliverable archived with it. Propose this FIRST when the user wants to change something that is archived — an archived record cannot be edited in place.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Restored deliverable from archive: Sales Item Master"',
      },
    },
    required: ["id"],
  },
};

const addProjectRiskDecl: FunctionDeclaration = {
  name: "addProjectRisk",
  description: "Add a new project risk.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      riskId: {
        type: Type.STRING,
        description:
          "Optional human-readable reference identifier (e.g., RSK-001).",
      },
      riskDescription: { type: Type.STRING },
      projectSpecificDescription: { type: Type.STRING },
      impactLevel: {
        type: Type.STRING,
        description:
          "Low, Moderate, High, Critical, Catastrophic, Positive (Opportunity)",
      },
      probability: {
        type: Type.STRING,
        description: "Rare, Low, Moderate, High, Almost Certain, Uncertain",
      },
      postMitigationImpactLevel: {
        type: Type.STRING,
        description:
          "Post-mitigation impact level. Possible values: Low, Moderate, High, Critical, Catastrophic, Positive (Opportunity)",
      },
      postMitigationProbability: {
        type: Type.STRING,
        description:
          "Post-mitigation probability level. Possible values: Rare, Low, Moderate, High, Almost Certain, Uncertain",
      },
      owner: { type: Type.STRING },
      mitigationStrategy: { type: Type.STRING },
      status: {
        type: Type.STRING,
        description: "Open, Under Mitigation, Mitigated",
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Created Risk: Delay in Environment Setup"',
      },
    },
    required: ["riskDescription", "status"],
  },
};

const updateProjectRiskDecl: FunctionDeclaration = {
  name: "updateProjectRisk",
  description: "Update an existing project risk.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      riskId: {
        type: Type.STRING,
        description:
          "Optional human-readable reference identifier (e.g., RSK-001).",
      },
      riskDescription: { type: Type.STRING },
      projectSpecificDescription: { type: Type.STRING },
      impactLevel: { type: Type.STRING },
      probability: { type: Type.STRING },
      postMitigationImpactLevel: {
        type: Type.STRING,
        description:
          "Post-mitigation impact level. Possible values: Low, Moderate, High, Critical, Catastrophic, Positive (Opportunity)",
      },
      postMitigationProbability: {
        type: Type.STRING,
        description:
          "Post-mitigation probability level. Possible values: Rare, Low, Moderate, High, Almost Certain, Uncertain",
      },
      owner: { type: Type.STRING },
      mitigationStrategy: { type: Type.STRING },
      status: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing the exact changes. Example: "Mitigated risk: Delayed data center signoff" or "Escalated critical budget risk"',
      },
    },
    required: ["id"],
  },
};

const deleteProjectRiskDecl: FunctionDeclaration = {
  name: "deleteProjectRisk",
  description: "Delete a project risk.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Deleted Risk: Setup legacy system"',
      },
    },
    required: ["id"],
  },
};

// Added 10 Sep. The Documents module (documentsStore.ts, Documents.tsx) existed
// in the app with no bridge or Gemini path to it at all — not a bug, just never
// wired up, the same gap risks had before Phase 2. Same add/update/delete shape
// as risks; no getDocumentDetailsDecl companion yet (Gemini's own chat-side
// detail-read tools), since nothing needed it yet. See PLAN.md section 17.
const addDocumentDecl: FunctionDeclaration = {
  name: "addDocument",
  description: "Add a new project document (a reference file, usually a link, with a title and type).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      url: { type: Type.STRING, description: "Link to the document, e.g. a Google Drive URL." },
      type: {
        type: Type.STRING,
        description: "Requirement, Design, Test, Report, Contract, Manual, Other",
      },
      status: {
        type: Type.STRING,
        description: "Draft, In Review, Approved, Archived",
      },
      version: { type: Type.STRING },
      owner: { type: Type.STRING },
      description: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Added Document: EMAI Official Syllabus"',
      },
    },
    required: ["title", "url"],
  },
};

const updateDocumentDecl: FunctionDeclaration = {
  name: "updateDocument",
  description: "Update an existing project document.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      title: { type: Type.STRING },
      url: { type: Type.STRING },
      type: { type: Type.STRING },
      status: { type: Type.STRING },
      version: { type: Type.STRING },
      owner: { type: Type.STRING },
      description: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing the exact changes. Example: "Updated Document: bumped Motivation Letter Template to v2"',
      },
    },
    required: ["id"],
  },
};

const deleteDocumentDecl: FunctionDeclaration = {
  name: "deleteDocument",
  description: "Delete a project document.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Deleted Document: outdated checklist"',
      },
    },
    required: ["id"],
  },
};

const addStakeholderDecl: FunctionDeclaration = {
  name: "addStakeholder",
  description: "Add a new project stakeholder.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      role: { type: Type.STRING, description: "Deprecated parameter - use projectRole instead" },
      projectRole: { type: Type.STRING, description: "Role within the project (e.g. Project Sponsor, PM, Tech Lead)" },
      orgRole: { type: Type.STRING, description: "Role within the organization (e.g. Director of Finance, VP of Engineering)" },
      organization: { type: Type.STRING },
      email: { type: Type.STRING },
      phone: { type: Type.STRING },
      power: { type: Type.STRING, description: "High, Medium, Low" },
      interest: { type: Type.STRING, description: "High, Medium, Low" },
      knowledge: { type: Type.STRING, description: "High, Medium, Low" },
      interPersonalRelations: {
        type: Type.STRING,
        description:
          "Interpersonal relationships or political alliances of the stakeholder.",
      },
      reportsToId: {
        type: Type.STRING,
        description:
          "The ID of the stakeholder this stakeholder reports to (organizationally).",
      },
      projectReportsToId: {
        type: Type.STRING,
        description:
          "The ID of the stakeholder this stakeholder reports to (within the project).",
      },
      notes: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Created Stakeholder: Alice Morgan (Product Sponsor)"',
      },
    },
    required: ["name"],
  },
};

const createMoMDecl: FunctionDeclaration = {
  name: "createMoM",
  description:
    "Create an official Minutes of Meeting (MoM) record directly in the MoM module for the active project. Use this when the user asks to create, log, or record a meeting or minutes of meeting.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Meeting Title. e.g., 'Sprint Planning & Architecture Sync'" },
      date: { type: Type.STRING, description: "Meeting Date YYYY-MM-DD" },
      time: { type: Type.STRING, description: "Meeting Time HH:MM (24-hour format)" },
      location: { type: Type.STRING, description: "Meeting Location or Link (e.g. 'Conference Room A' or 'Teams Virtual Call')" },
      attendees: { type: Type.STRING, description: "Comma-separated list of attendees with roles if known" },
      agenda: { type: Type.STRING, description: "Meeting Agenda (Markdown or text supported)" },
      notes: { type: Type.STRING, description: "Meeting Discussion Notes, Points, or Details (Markdown or text supported)" },
      keyDecisions: { type: Type.STRING, description: "Key Decisions and Agreements reached (Markdown or text supported)" },
      actionItems: {
        type: Type.ARRAY,
        description:
          "Every action agreed in the meeting. Put them ONLY here. Signing off does NOT file them in the task tracker; the user pushes each one from the minutes when they choose. Do NOT also call addTask for the same action; that makes a second, unlinked copy of it.",
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING, description: "What has to be done" },
            assignee: { type: Type.STRING, description: "Person responsible" },
            status: { type: Type.STRING, description: "'Open' | 'In Progress' | 'Blocked' | 'Done' | 'Dropped'. Defaults to Open." },
            type: { type: Type.STRING, description: "'Action Item' or 'Issue'. Defaults to Action Item." },
            priority: { type: Type.STRING, description: "'Low', 'Medium' or 'High'" },
            estimatedResolutionDate: { type: Type.STRING, description: "Due date, YYYY-MM-DD" },
            remarks: { type: Type.STRING, description: "Any note that belongs on the task" },
            linkedActivityIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Timeline activity ids this action belongs to",
            },
          },
          required: ["description"],
        },
      },
      changeTitle: {
        type: Type.STRING,
        description: 'Required: Descriptive title. e.g., "Created MoM: Sprint Planning Sync"',
      },
    },
    required: ["title", "changeTitle"],
  },
};

const updateMomDecl: FunctionDeclaration = {
  name: "updateMom",
  description: "Update an existing Minutes of Meeting (MoM) record.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "ID of the MoM record to update" },
      title: { type: Type.STRING },
      date: { type: Type.STRING },
      time: { type: Type.STRING },
      location: { type: Type.STRING },
      attendees: { type: Type.STRING },
      agenda: { type: Type.STRING },
      notes: { type: Type.STRING },
      keyDecisions: { type: Type.STRING },
      actionItems: {
        type: Type.ARRAY,
        description:
          "The FULL list of action items after your change — it replaces the existing list, so include the ones you are keeping. Signing off does not file any item in the task tracker; the user pushes items from the minutes. Keep the `id` of an item that already exists, or it will be treated as new.",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING, description: "Keep this for an item that already exists" },
            description: { type: Type.STRING },
            assignee: { type: Type.STRING },
            status: { type: Type.STRING, description: "'Open' | 'In Progress' | 'Blocked' | 'Done' | 'Dropped'" },
            type: { type: Type.STRING, description: "'Action Item' or 'Issue'" },
            priority: { type: Type.STRING, description: "'Low', 'Medium' or 'High'" },
            estimatedResolutionDate: { type: Type.STRING, description: "Due date, YYYY-MM-DD" },
            remarks: { type: Type.STRING },
            linkedActivityIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        },
      },
      changeTitle: {
        type: Type.STRING,
        description: 'Required: Descriptive title. e.g., "Updated MoM: Sprint Planning Sync"',
      },
    },
    required: ["id", "changeTitle"],
  },
};

const deleteMomDecl: FunctionDeclaration = {
  name: "deleteMom",
  description: "Delete an existing Minutes of Meeting (MoM) record.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING, description: "ID of the MoM record to delete" },
      changeTitle: {
        type: Type.STRING,
        description: 'Required: Descriptive title. e.g., "Deleted MoM: Sprint Planning Sync"',
      },
    },
    required: ["id", "changeTitle"],
  },
};

const updateMeetingDraftDecl: FunctionDeclaration = {
  name: "updateMeetingDraft",
  description:
    "Propose updates to the current Meeting Outcome Draft (MoM data, Action Items). Call this tool when analyzing a live transcription session to output structured Meeting results. The changes will be applied to the meeting review UI for the user to approve.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Meeting Title" },
      date: { type: Type.STRING, description: "Meeting Date YYYY-MM-DD" },
      time: { type: Type.STRING, description: "Meeting Time HH:MM" },
      location: { type: Type.STRING },
      attendees: { type: Type.STRING },
      agenda: { type: Type.STRING },
      keyDecisions: { type: Type.STRING },
      notes: { type: Type.STRING },
      actionItems: {
        type: Type.ARRAY,
        description: "New action items to add to the meeting outcome draft",
        items: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            assignee: { type: Type.STRING },
            status: { type: Type.STRING, description: "'Open' | 'In Progress' | 'Blocked' | 'Done' | 'Dropped'" },
            type: { type: Type.STRING, description: "'Action Item' or 'Issue'" },
            priority: { type: Type.STRING, description: "'Low', 'Medium' or 'High'" },
            estimatedResolutionDate: { type: Type.STRING, description: "Due date, YYYY-MM-DD" },
            remarks: { type: Type.STRING },
          },
        },
      },
      updatesToExistingRecords: {
        type: Type.ARRAY,
        description:
          "Any timeline or database updates required based on the meeting.",
        items: {
          type: Type.OBJECT,
          properties: {
            recordId: { type: Type.STRING },
            recordTitle: { type: Type.STRING },
            type: { type: Type.STRING, description: '"Timeline" | "Tasks"' },
            updates: {
              type: Type.OBJECT,
              description: "JSON object of the updates",
            },
          },
        },
      },
      changeTitle: {
        type: Type.STRING,
        description:
          'Required: Descriptive title. e.g., "Drafted Meeting Outcome"',
      },
    },
    required: ["changeTitle"],
  },
};

const updateStakeholderDecl: FunctionDeclaration = {
  name: "updateStakeholder",
  description: "Update an existing stakeholder.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      name: { type: Type.STRING },
      role: { type: Type.STRING, description: "Deprecated parameter - use projectRole instead" },
      projectRole: { type: Type.STRING, description: "Role within the project (e.g. Project Sponsor, PM, Tech Lead)" },
      orgRole: { type: Type.STRING, description: "Role within the organization (e.g. Director of Finance, VP of Engineering)" },
      organization: { type: Type.STRING },
      email: { type: Type.STRING },
      phone: { type: Type.STRING },
      power: { type: Type.STRING, description: "High, Medium, Low" },
      interest: { type: Type.STRING, description: "High, Medium, Low" },
      knowledge: { type: Type.STRING, description: "High, Medium, Low" },
      interPersonalRelations: {
        type: Type.STRING,
        description:
          "Interpersonal relationships or political alliances of the stakeholder.",
      },
      reportsToId: {
        type: Type.STRING,
        description: "The ID of the stakeholder this stakeholder reports to.",
      },
      projectReportsToId: {
        type: Type.STRING,
        description:
          "The ID of the stakeholder this stakeholder reports to (within the project).",
      },
      notes: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title detailing the details changed. Example: "Updated contact details for John Doe"',
      },
    },
    required: ["id"],
  },
};

const deleteStakeholderDecl: FunctionDeclaration = {
  name: "deleteStakeholder",
  description: "Delete a stakeholder.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      changeTitle: {
        type: Type.STRING,
        description:
          'A highly descriptive change title. Example: "Deleted Stakeholder: Dr. Robert Ford"',
      },
    },
    required: ["id"],
  },
};

const addDeliverableCommentDecl: FunctionDeclaration = {
  name: "addDeliverableComment",
  description: "Add a comment to an existing deliverable.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      deliverableId: {
        type: Type.STRING,
        description: "The unique ID of the deliverable.",
      },
      text: { type: Type.STRING, description: "The comment text." },
    },
    required: ["deliverableId", "text"],
  },
};

// --- NEW QUERY TOOLS ---
const readCodexPageDecl: FunctionDeclaration = {
  name: "readCodexPage",
  description: "Read the full content of a specific Codex page.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING } },
    required: ["id"],
  },
};

const getTaskDetailsDecl: FunctionDeclaration = {
  name: "getTaskDetails",
  description: "Get full details, remarks, and comments for a specific task.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING } },
    required: ["id"],
  },
};

const getDeliverableDetailsDecl: FunctionDeclaration = {
  name: "getDeliverableDetails",
  description:
    "Get full details, definition of done, owner, comments, and any sub-deliverables inside its nested space for a specific deliverable.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING } },
    required: ["id"],
  },
};

const getTimelineRowDetailsDecl: FunctionDeclaration = {
  name: "getTimelineRowDetails",
  description:
    "Get full details, remarks, and calculation formulas for a specific timeline activity row.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      revisionId: {
        type: Type.STRING,
        description:
          "Optional ID of the timeline revision. Defaults to active.",
      },
      id: { type: Type.STRING },
    },
    required: ["id"],
  },
};

const getRiskDetailsDecl: FunctionDeclaration = {
  name: "getRiskDetails",
  description:
    "Get full details and mitigation strategies for a specific project risk.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING } },
    required: ["id"],
  },
};

const getStakeholderDetailsDecl: FunctionDeclaration = {
  name: "getStakeholderDetails",
  description:
    "Get full details, notes, and interpersonal relations for a specific stakeholder.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING } },
    required: ["id"],
  },
};

const getMomDetailsDecl: FunctionDeclaration = {
  name: "getMomDetails",
  description:
    "Get full minutes of meeting (MoM) details including notes, decisions, and action items for a specific meeting log.",
  parameters: {
    type: Type.OBJECT,
    properties: { id: { type: Type.STRING } },
    required: ["id"],
  },
};
const getArchivedItemsDecl: FunctionDeclaration = {
  name: "getArchivedItems",
  description:
    "List the ARCHIVED records of a module. Archived records are deliberately absent from the project state and from search, so this is the only way to see them. Returns them newest archive first, with a total so you can tell an empty archive from a query that matched nothing.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      module: {
        type: Type.STRING,
        description: 'Which archive to read: "tasks", "deliverables" or "risks". For deliverables only subtree roots are listed — a sub-deliverable archived with its parent is filed under that parent, not listed separately.',
      },
      query: {
        type: Type.STRING,
        description:
          "Optional words to look for, matched as a substring of the description, owner, remarks, source, status or type.",
      },
      limit: {
        type: Type.NUMBER,
        description: "How many records to return. Default 25, maximum 100.",
      },
    },
    required: ["module"],
  },
};

// --- END QUERY TOOLS ---

export const QUERY_TOOL_NAMES = [
  "readCodexPage",
  "getArchivedItems",
  "getTaskDetails",
  "getDeliverableDetails",
  "getTimelineRowDetails",
  "getRiskDetails",
  "getStakeholderDetails",
  "getMomDetails",
];

interface AISidebarProps {
  onClose: () => void;
  isOpen: boolean;
}

const ThoughtProcess: React.FC<{
  content: string;
  isStreaming?: boolean;
  title?: string;
}> = ({ content, isStreaming, title }) => {
  const [isOpen, setIsOpen] = useState(false);

  const extractedTitle = React.useMemo(() => {
    if (!isStreaming) return undefined;
    if (title) return title;
    const matches = [...content.matchAll(/\*\*([^*]+)\*\*/g)];
    if (matches.length > 0) {
      return matches[matches.length - 1][1].trim();
    }
    return undefined;
  }, [content, title, isStreaming]);

  return (
    <div className="bg-qb-box-bg border border-qb-light-grey border-l-2 border-l-qb-grey p-3 text-xs text-qb-grey font-mono w-[90%] overflow-hidden">
      <div
        className="font-black uppercase tracking-widest flex items-center justify-between cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-1">
          <GeminiIcon
            className={`w-3 h-3 ${isStreaming ? "animate-pulse text-qb-orange" : ""}`}
          />
          {extractedTitle ? (
            <span className="flex items-center gap-2">
              {extractedTitle}
              {isStreaming && (
                <span className="text-[10px] bg-qb-orange text-white px-1 py-0.5 rounded-sm animate-pulse">
                  STREAMING
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              Thoughts
              {isStreaming && (
                <span className="text-[10px] bg-qb-orange text-white px-1 py-0.5 rounded-sm animate-pulse">
                  STREAMING
                </span>
              )}
            </span>
          )}
        </div>
        <div
          className={`transition-transform duration-300 ${isOpen ? "rotate-180" : "rotate-0"}`}
        >
          ▼
        </div>
      </div>
      <div
        className={`grid transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? "grid-rows-[1fr] mt-2 pt-2 border-t border-qb-light-grey opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <AIResponseRenderer content={content} variant="mono" />
        </div>
      </div>
    </div>
  );
};

const ActionGroup = ({
  functionCalls,
  nextMessage,
}: {
  functionCalls: any[];
  nextMessage?: Content;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const functionResponses =
    nextMessage?.parts?.filter((p) => p.functionResponse) || [];

  return (
    <div className="bg-qb-box-bg border border-qb-light-grey border-l-2 border-l-qb-orange w-[90%] text-xs flex flex-col transition-all duration-300">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-3 hover:bg-qb-light-grey/30 transition-colors w-full text-left outline-none"
      >
        <div className="font-black uppercase tracking-widest text-qb-dark-grey flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-qb-orange" />
          <span>
            {functionCalls.length} ACTION{functionCalls.length !== 1 ? "S" : ""}{" "}
            PERFORMED
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-qb-grey" />
        ) : (
          <ChevronRight className="w-4 h-4 text-qb-grey" />
        )}
      </button>
      {isExpanded && (
        <div className="p-0 flex flex-col gap-3 border-t border-dashed border-qb-light-grey mx-3">
          {functionCalls.map((fc, idx) => {
            const matchedResponse = functionResponses.find(
              (r) =>
                r.functionResponse?.id === fc.functionCall?.id ||
                r.functionResponse?.name === fc.functionCall?.name,
            );
            const beforeData =
              matchedResponse?.functionResponse?.response?.beforeData;
            const afterData =
              matchedResponse?.functionResponse?.response?.afterData;
            const isUpdate = !!beforeData && !!afterData;

            return (
              <div
                key={`fc-${idx}`}
                className="flex flex-col gap-1.5 mt-3 first:mt-3 last:mb-3"
              >
                <div className="font-black uppercase tracking-widest text-qb-dark-grey text-[10px] flex items-center gap-2">
                  <span className="text-qb-orange">•</span>{" "}
                  {fc.functionCall?.name}
                </div>
                {isUpdate ? (
                  <div className="flex flex-col gap-2">
                    <div className="font-mono text-[10px] text-qb-grey overflow-x-auto whitespace-pre-wrap bg-qb-box-bg border border-qb-light-grey p-2">
                      <div className="font-bold text-qb-magenta mb-1 border-b border-qb-light-grey pb-1 uppercase tracking-widest text-[9px]">
                        BEFORE
                      </div>
                      {JSON.stringify(beforeData, null, 2)}
                    </div>
                    <div className="font-mono text-[10px] text-qb-grey overflow-x-auto whitespace-pre-wrap bg-transparent border border-qb-light-grey p-2">
                      <div className="font-bold text-qb-green mb-1 border-b border-qb-light-grey pb-1 uppercase tracking-widest text-[9px]">
                        AFTER
                      </div>
                      {JSON.stringify(afterData, null, 2)}
                    </div>
                  </div>
                ) : (
                  fc.functionCall?.args &&
                  Object.keys(fc.functionCall.args).length > 0 && (
                    <div className="font-mono text-[10px] text-qb-grey overflow-x-auto whitespace-pre-wrap bg-transparent border border-qb-light-grey p-2">
                      {JSON.stringify(fc.functionCall?.args, null, 2)}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
  size: number;
  extractedText?: string;
}

const isNativelySupportedForInlineData = (mimeType: string): boolean => {
  const mimeLower = mimeType.toLowerCase();
  return (
    mimeLower === "application/pdf" ||
    mimeLower.startsWith("image/") ||
    mimeLower.startsWith("audio/") ||
    mimeLower.startsWith("video/")
  );
};

const extractTextFromFile = async (file: File): Promise<string | null> => {
  const fileExtension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.type || "";

  // 1. Check if it's a Word document
  if (
    fileExtension === "docx" ||
    mimeType.includes("word") ||
    mimeType.includes("officedocument.wordprocessingml")
  ) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { default: mammoth } = await import("mammoth");
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value || "";
    } catch (err) {
      console.error("Failed to extract text from Word document:", err);
      return `[Error extracting Word document text: ${err}]`;
    }
  }

  // 2. Check if it's an Excel spreadsheet
  if (
    fileExtension === "xlsx" ||
    fileExtension === "xls" ||
    mimeType.includes("excel") ||
    mimeType.includes("spreadsheet")
  ) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      let fullCsv = "";
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        if (csv.trim()) {
          fullCsv += `Sheet: ${sheetName}\n----------------------------------------\n${csv}\n\n`;
        }
      });
      return fullCsv || "[Empty Spreadsheet]";
    } catch (err) {
      console.error("Failed to extract text from Spreadsheet:", err);
      return `[Error extracting Spreadsheet text: ${err}]`;
    }
  }

  // 2.5. Check if it's a PowerPoint presentation
  if (
    fileExtension === "pptx" ||
    mimeType.includes("powerpoint") ||
    mimeType.includes("officedocument.presentationml.presentation") ||
    mimeType.includes("officedocument.presentationml")
  ) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(arrayBuffer);

      const slideKeys = Object.keys(zip.files).filter(
        (key) => key.startsWith("ppt/slides/slide") && key.endsWith(".xml"),
      );

      if (slideKeys.length === 0) {
        return "[PowerPoint empty of slide files]";
      }

      // Sort slideKeys numerically (slide1.xml, slide2.xml, ..., slide10.xml)
      slideKeys.sort((a, b) => {
        const numA = parseInt(a.replace(/[^0-9]/g, "") || "0", 10);
        const numB = parseInt(b.replace(/[^0-9]/g, "") || "0", 10);
        return numA - numB;
      });

      let slidesContent = "";
      const parser = new DOMParser();

      const getFormattedText = (tTag: Element): string => {
        let text = tTag.textContent || "";
        if (!text.trim()) return text;

        const parent = tTag.parentElement;
        if (
          parent &&
          (parent.tagName === "a:r" || parent.tagName === "a:fld")
        ) {
          const rPr = parent.getElementsByTagName("a:rPr")[0];
          if (rPr) {
            const strikeAttr = rPr.getAttribute("strike");
            const isStrike = strikeAttr && strikeAttr !== "noStrike";
            const isBold = rPr.getAttribute("b") === "1";
            const isItalic = rPr.getAttribute("i") === "1";
            const isUnderline =
              rPr.getAttribute("u") && rPr.getAttribute("u") !== "none";

            const leadingSpace = text.match(/^\s*/)?.[0] || "";
            const trailingSpace = text.match(/\s*$/)?.[0] || "";
            let trimmed = text.trim();

            if (isBold) trimmed = `**${trimmed}**`;
            if (isItalic) trimmed = `*${trimmed}*`;
            if (isUnderline) trimmed = `<u>${trimmed}</u>`;
            if (isStrike) trimmed = `~~${trimmed}~~`;

            text = leadingSpace + trimmed + trailingSpace;
          }
        }
        return text;
      };

      for (let i = 0; i < slideKeys.length; i++) {
        const key = slideKeys[i];
        const slideXmlText = await zip.files[key].async("string");
        const xmlDoc = parser.parseFromString(slideXmlText, "application/xml");

        // Find paragraph elements a:p so we can reconstruct layout line-by-line
        const pTags = xmlDoc.getElementsByTagName("a:p");
        let slideText = "";

        for (let pIdx = 0; pIdx < pTags.length; pIdx++) {
          const pTag = pTags[pIdx];
          const tTags = pTag.getElementsByTagName("a:t");
          let lineText = "";
          for (let tIdx = 0; tIdx < tTags.length; tIdx++) {
            lineText += getFormattedText(tTags[tIdx]);
          }
          if (lineText.trim()) {
            slideText += lineText + "\n";
          }
        }

        // Fallback to searching all a:t directly if no structured a:p content found
        if (!slideText.trim()) {
          const tTags = xmlDoc.getElementsByTagName("a:t");
          const words: string[] = [];
          for (let tIdx = 0; tIdx < tTags.length; tIdx++) {
            const formatted = getFormattedText(tTags[tIdx]);
            if (formatted.trim()) {
              words.push(formatted);
            }
          }
          slideText = words.join(" ");
        }

        if (slideText.trim()) {
          slidesContent += `--- SLIDE ${i + 1} ---\n${slideText.trim()}\n\n`;
        } else {
          slidesContent += `--- SLIDE ${i + 1} ---\n[Empty Slide]\n\n`;
        }
      }
      return slidesContent || "[No readable text in PowerPoint slides]";
    } catch (err) {
      console.error("Failed to extract text from PowerPoint:", err);
      return `[Error extracting PowerPoint text: ${err instanceof Error ? err.message : String(err)}]`;
    }
  }

  // 3. Check if it is a recognized native binary format (e.g. PDF, Images, Video, Audio)
  const isNativeBinary =
    mimeType.includes("pdf") ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/");

  if (isNativeBinary) {
    return null; // Let standard inlineData handle it natively
  }

  // 4. Fallback: Treat as a text/code file
  const textExtensions = [
    "txt",
    "csv",
    "md",
    "json",
    "js",
    "jsx",
    "ts",
    "tsx",
    "html",
    "css",
    "yaml",
    "yml",
    "xml",
    "sh",
    "py",
    "sql",
    "ini",
    "log",
    "env",
    "conf",
    "rc",
  ];
  const isTextExt = textExtensions.includes(fileExtension || "");
  const isTextMime =
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/javascript";

  if (isTextExt || isTextMime || file.size < 5 * 1024 * 1024) {
    // Limit to 5MB
    try {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    } catch (err) {
      console.error("Failed to read file as plain text:", err);
      return `[Error reading text file: ${err}]`;
    }
  }

  return null;
};

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith("image/"))
    return <Image className="w-3.5 h-3.5 text-qb-cyan" />;
  if (mimeType.startsWith("audio/"))
    return <Music className="w-3.5 h-3.5 text-qb-orange" />;
  if (mimeType.startsWith("video/"))
    return <Video className="w-3.5 h-3.5 text-qb-magenta" />;
  if (mimeType.includes("pdf"))
    return <FileText className="w-3.5 h-3.5 text-qb-orange" />;
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("csv")
  )
    return <FileText className="w-3.5 h-3.5 text-qb-green" />;
  if (mimeType.includes("word") || mimeType.includes("document"))
    return <FileText className="w-3.5 h-3.5 text-qb-cyan" />;
  return <Paperclip className="w-3.5 h-3.5 text-qb-grey" />;
};

const getModulePathForTool = (toolName: string): string => {
  if (toolName.includes("Timeline") || toolName.includes("Activity"))
    return "/timeline";
  // The unarchive branches must come BEFORE the catch-all for their module,
  // because the catch-all matches on the noun and would swallow them.
  //
  // An archiveTask/archiveDeliverable proposal is still an ACTIVE record until
  // it is approved, so the active page is right for it. An unarchive proposal
  // is not: that record is in the archive, and that is where "go to page" has
  // to land.
  if (toolName === "unarchiveDeliverable") return "/deliverables/archive";
  if (toolName.includes("Deliverable")) return "/deliverables";
  if (toolName === "unarchiveTask") return "/tasks-issues/archive";
  if (toolName === "unarchiveProjectRisk") return "/risks/archive";
  if (toolName.includes("Task")) return "/tasks-issues";
  if (toolName.includes("Risk")) return "/risks";
  if (toolName.includes("Stakeholder")) return "/stakeholders";
  if (toolName.includes("Codex")) return "/codex";
  if (toolName.includes("Document")) return "/documents";
  // Billing was missing, so a milestone proposal had no page to go to at all.
  if (toolName.includes("Milestone") || toolName.includes("Billing"))
    return "/billing";
  if (
    toolName.includes("Mom") ||
    toolName.includes("MoM") ||
    toolName.includes("Meeting")
  )
    return "/mom";
  return "";
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const AISidebar: React.FC<AISidebarProps> = ({ onClose, isOpen }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const {
    activeAcrId,
    activeAcrChangeId,
    attachedAcrChange,
    setActiveAcrId,
    setActiveAcrChangeId,
    setAttachedAcrChange,
    createAcr,
    getPendingAcrForSession,
    updateAcrChangeApproval,
    updateAcrChange,
    updateAllChangesApproval,
    setAcrStatus,
    deleteAcr,
    isMouseOverSidebar,
    setIsMouseOverSidebar,
    isChatHiddenDuringReview,
    setIsChatHiddenDuringReview,
  } = useAcrStore();

  const [editingChangeId, setEditingChangeId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isInputEmpty, setIsInputEmpty] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (err) {
        console.warn("Abort error:", err);
      }
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setStreamingMessage(null);
  };

  const addFiles = async (filesArray: File[]) => {
    for (const file of filesArray) {
      try {
        const extractedText = await extractTextFromFile(file);

        // Standard reading of base64 data URL
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const resultString = reader.result as string;
            resolve(resultString.split(",")[1] || "");
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        setAttachedFiles((prev) => [
          ...prev,
          {
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            base64,
            size: file.size,
            extractedText: extractedText || undefined,
          },
        ]);
      } catch (err) {
        console.error("Error adding file:", err);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(Array.from(e.clipboardData.files));
    }
  };

  const renderFileAttachment = (part: any, index: number, isDark: boolean) => {
    const mimeType = part.inlineData?.mimeType || "application/octet-stream";
    const base64 = part.inlineData?.data || "";
    const name = part._filename || `attached_file_${index + 1}`;
    const size = part._filesize
      ? formatFileSize(part._filesize)
      : "Unknown size";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const isImage = mimeType.startsWith("image/") && base64;

    if (isImage) {
      return (
        <div
          key={index}
          className={`flex flex-col gap-1 border p-2 w-[145px] ${
            isDark
              ? "border-white/20 bg-white/5 text-white"
              : "border-qb-light-grey bg-qb-box-bg text-qb-black"
          }`}
        >
          <div className="relative group overflow-hidden border border-qb-light-grey bg-qb-bg h-24 flex items-center justify-center">
            <img
              src={dataUrl}
              alt={name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain cursor-pointer hover:scale-105 transition-transform"
              onClick={() => {
                const newTab = window.open();
                if (newTab) {
                  newTab.document.write(
                    `<img src="${dataUrl}" style="max-width:100%; max-height:100%; display:block; margin:auto;" />`,
                  );
                }
              }}
            />
          </div>
          <div className="flex flex-col mt-1 min-w-0">
            <span className="font-mono text-[10px] truncate" title={name}>
              {name}
            </span>
            <span className="text-[9px] text-qb-grey font-mono">{size}</span>
          </div>
        </div>
      );
    }

    return (
      <div
        key={index}
        onClick={() => {
          if (!base64) return;
          const link = document.createElement("a");
          link.href = dataUrl;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }}
        className={`flex items-center gap-2 border p-2 select-none transition-all w-[180px] min-w-0 ${
          !base64 ? "cursor-default" : "cursor-pointer"
        } ${
          isDark
            ? `border-white/20 bg-white/5 text-white ${base64 ? "hover:bg-white/10" : ""}`
            : `border-qb-light-grey bg-qb-box-bg text-qb-black ${base64 ? "hover:bg-qb-light-grey/30" : ""}`
        }`}
        title={!base64 ? "Attachment in history" : "Click to download file"}
      >
        <div className="shrink-0 p-1 bg-qb-black/5 border border-qb-light-grey">
          {getFileIcon(mimeType)}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="font-mono text-[10px] font-bold truncate pr-1"
            title={name}
          >
            {name}
          </p>
          <p className="text-[9px] text-qb-grey font-mono truncate">
            {size} •{" "}
            <span className="uppercase">
              {mimeType.split("/")[1] || "FILE"}
            </span>
          </p>
        </div>
      </div>
    );
  };
  const [streamingMessage, setStreamingMessage] = useState<Content | null>(
    null,
  );
  const [pendingBatch, setPendingBatch] = useState<{
    id: string;
    calls: { id: string; call: FunctionCall; name: string; args: any }[];
  } | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isSessionDropdownOpen, setIsSessionDropdownOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitle, setEditingSessionTitle] = useState("");
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(
    null,
  );
  const [editingMessageText, setEditingMessageText] = useState<string>("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    DEFAULT_THINKING_LEVEL,
  );
  const [sessionFilterTab, setSessionFilterTab] = useState<'project' | 'all'>('project');

  const { templates: promptTemplates } = usePromptTemplatesStore();
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<TemplateCategory | 'All'>('All');
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [templatePickerSearch, setTemplatePickerSearch] = useState('');

  const handleSelectTemplate = (template: PromptTemplate, autoSend = false) => {
    if (inputRef.current) {
      inputRef.current.value = template.prompt;
      setIsInputEmpty(false);
      inputRef.current.focus();
      setIsTemplatePickerOpen(false);
      if (autoSend) {
        setTimeout(() => {
          handleSend();
        }, 50);
      }
    }
  };

  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const getProjectTimeline = useTimelineStore(
    (state) => state.getProjectTimeline,
  );
  // The timeline write actions used to be bound here for the executor that
  // lived in this file. The executor now lives in src/services/acrExecutor.ts
  // and reads its own stores, so only the read is still needed here.

  const codexPages = useCodexStore((state) => state.pages);
  const updateCodexPage = useCodexStore((state) => state.updatePage);

  const addDeliverable = useDeliverablesStore((state) => state.addDeliverable);
  const updateDeliverable = useDeliverablesStore(
    (state) => state.updateDeliverable,
  );
  const deleteDeliverable = useDeliverablesStore(
    (state) => state.deleteDeliverable,
  );
  const addComment = useDeliverablesStore((state) => state.addComment);
  const getDeliverablesByProject = useDeliverablesStore(
    (state) => state.getDeliverablesByProject,
  );

  const addTask = useTasksStore((state) => state.addTask);
  const updateTask = useTasksStore((state) => state.updateTask);
  const deleteTask = useTasksStore((state) => state.deleteTask);
  const addTaskComment = useTasksStore((state) => state.addComment);
  const getTasksByProject = useTasksStore((state) => state.getTasksByProject);

  const addProjectRisk = useRisksStore((state) => state.addRisk);
  const updateProjectRisk = useRisksStore((state) => state.updateRisk);
  const deleteProjectRisk = useRisksStore((state) => state.deleteRisk);
  const getProjectRisks = useRisksStore((state) => state.getProjectRisks);

  const addStakeholder = useStakeholdersStore((state) => state.addStakeholder);
  const updateStakeholder = useStakeholdersStore(
    (state) => state.updateStakeholder,
  );
  const deleteStakeholder = useStakeholdersStore(
    (state) => state.deleteStakeholder,
  );
  const allStakeholders = useStakeholdersStore((state) => state.stakeholders);
  const allMoms = useMomStore((state) => state.moms);
  const allDocuments = useDocumentsStore((state) => state.documents);
  const allMilestones = useBillingStore((state) => state.milestones);
  const isBillingEnabled = useBillingStore((state) => state.isEnabled);

  const aiSessions = useAiStore((state) => state.sessions);
  const activeSessionId = useAiStore((state) => state.activeSessionId);
  const createSession = useAiStore((state) => state.createSession);
  const updateSessionMessages = useAiStore(
    (state) => state.updateSessionMessages,
  );
  const setActiveSessionId = useAiStore((state) => state.setActiveSessionId);
  const renameSession = useAiStore((state) => state.renameSession);
  const deleteSession = useAiStore((state) => state.deleteSession);

  const location = useLocation();
  const projectTimeline = activeProjectId
    ? getProjectTimeline(activeProjectId)
    : undefined;
  const baseline = projectTimeline
    ? projectTimeline.revisions.find(
        (r: any) => r.id === projectTimeline.activeRevisionId,
      )
    : undefined;
  const projectCodexPages = activeProjectId
    ? codexPages.filter((p) => p.projectId === activeProjectId)
    : [];
  const projectDeliverables = activeProjectId
    ? getDeliverablesByProject(activeProjectId)
    : [];
  const projectTasks = activeProjectId
    ? getTasksByProject(activeProjectId)
    : [];
  const projectRisks = activeProjectId ? getProjectRisks(activeProjectId) : [];
  const projectStakeholders = activeProjectId
    ? allStakeholders.filter((s: any) => s.projectId === activeProjectId)
    : [];
  const projectMoms = activeProjectId
    ? allMoms.filter((m) => m.projectId === activeProjectId)
    : [];
  const projectDocuments = activeProjectId
    ? allDocuments.filter((d) => d.projectId === activeProjectId)
    : [];
  const projectMilestones = activeProjectId
    ? allMilestones.filter((m) => m.projectId === activeProjectId)
    : [];


  useEffect(() => {
    if (aiSessions.length > 0) {
      const activeSessionExists = activeSessionId && aiSessions.some((s) => s.id === activeSessionId);
      if (!activeSessionExists) {
        // Find sessions matching active project or unassigned
        const matchingSessions = aiSessions.filter(
          (s) => !activeProjectId || !s.projectId || s.projectId === "" || s.projectId === activeProjectId
        );
        if (matchingSessions.length > 0) {
          const withMsgs = matchingSessions.filter((s) => (s.messages?.length || 0) > 0);
          const best = (withMsgs.length > 0 ? withMsgs : matchingSessions).sort(
            (a, b) =>
              new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
          )[0];
          setActiveSessionId(best.id);
        } else if (activeProjectId) {
          createSession(activeProjectId);
        }
      }
    } else if (activeProjectId && !activeSessionId) {
      createSession(activeProjectId);
    }
  }, [
    activeProjectId,
    activeSessionId,
    aiSessions,
    createSession,
    setActiveSessionId,
  ]);

  const activeSession = aiSessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({
            behavior: "auto",
            block: "nearest",
          });
        }
      }, 50);
    }
  }, [isOpen, activeSessionId, messages.length]);

  const groupMessagesIntoTurns = (msgs: Content[]) => {
    interface TraceElement {
      id: string;
      type: "thought" | "query" | "action";
      text?: string;
      title?: string;
      functionCall?: any;
      response?: any;
      durationSeconds?: number;
    }

    interface VisualTurn {
      id: string;
      userMessage?: any;
      userMessageIndex: number;
      traceElements: TraceElement[];
      assistantResponses: Array<{
        message: any;
        index: number;
        executableParts: any[];
      }>;
    }

    const turns: VisualTurn[] = [];
    let currentTurn: VisualTurn | null = null;

    msgs.forEach((m, index) => {
      if ((m as any)._isHidden) return;
      if (
        m.role === "user" &&
        m.parts?.length === 1 &&
        m.parts[0].text?.startsWith(
          "The user reviewed the proposed Assistant Change Request (ACR)",
        )
      )
        return;

      const isFunctionResponse =
        m.role === "user" && m.parts?.some((p) => p.functionResponse);

      if (isFunctionResponse) {
        if (currentTurn) {
          m.parts?.forEach((p) => {
            if (p.functionResponse) {
              const respName = p.functionResponse.name;
              const respId = p.functionResponse.id;
              const element = [...currentTurn!.traceElements]
                .reverse()
                .find(
                  (el) =>
                    (el.type === "query" || el.type === "action") &&
                    el.functionCall?.name === respName &&
                    (!respId || el.functionCall?.id === respId),
                );
              if (element) {
                element.response = p.functionResponse.response;
              }
            }
          });
        }
        return;
      }

      if (m.role === "user") {
        currentTurn = {
          id: `turn-${index}`,
          userMessage: m,
          userMessageIndex: index,
          traceElements: [],
          assistantResponses: [],
        };
        turns.push(currentTurn);
        return;
      }

      if (m.role === "model") {
        if (!currentTurn) {
          currentTurn = {
            id: `turn-model-${index}`,
            userMessageIndex: -1,
            traceElements: [],
            assistantResponses: [],
          };
          turns.push(currentTurn);
        }

        const thoughts = m.parts?.filter((p) => p.thought) || [];
        thoughts.forEach((tp, tIdx) => {
          currentTurn!.traceElements.push({
            id: `thought-${index}-${tIdx}`,
            type: "thought",
            text: tp.text || "",
            title:
              tp.thoughtSignature || (tp as any).thought_signature || undefined,
            durationSeconds: tIdx === 0 ? (m as any)._thoughtDurationSeconds : undefined,
          });
        });

        const executableParts = m.parts?.filter((p) => !p.thought) || [];
        const functionCalls = executableParts.filter((p) => p.functionCall);
        functionCalls.forEach((fp, fIdx) => {
          const isQuery = QUERY_TOOL_NAMES.includes(fp.functionCall!.name);
          currentTurn!.traceElements.push({
            id: `func-${index}-${fIdx}`,
            type: isQuery ? "query" : "action",
            functionCall: fp.functionCall,
          });
        });

        if (
          executableParts.some((p) => p.text) ||
          executableParts.some((p) => p.inlineData)
        ) {
          currentTurn.assistantResponses.push({
            message: m,
            index: index,
            executableParts: executableParts,
          });
        }
      }
    });

    return turns;
  };

  useGSAP(
    () => {
      if (isOpen) {
        gsap.fromTo(
          ".sidebar-content",
          {
            y: 20,
            opacity: 0,
          },
          {
            y: 0,
            opacity: 1,
            duration: 0.6,
            stagger: 0.1,
            ease: "power3.out",
            delay: 0.2, // Wait for container slide-in
          },
        );
      } else {
        gsap.to(".sidebar-content", {
          opacity: 0,
          duration: 0.2,
          ease: "power2.in",
        });
      }
    },
    { dependencies: [isOpen], scope: containerRef },
  );

  useGSAP(
    () => {
      const unAnimated = gsap.utils.toArray(".chat-message:not(.animated)");
      if (unAnimated.length > 0) {
        gsap.fromTo(
          unAnimated,
          {
            opacity: 0,
            y: 20,
            scale: 0.98,
          },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.5,
            stagger: 0.1,
            ease: "power3.out",
            onComplete: () => {
              unAnimated.forEach((el: any) => el.classList.add("animated"));
            },
          },
        );
      }
    },
    {
      dependencies: [messages.length, !!streamingMessage],
      scope: containerRef,
    },
  );

  const handleSend = async () => {
    const userText = (inputRef.current?.value || "").trim();
    if (!userText && attachedFiles.length === 0) return;
    if (isLoading) return;

    const currentFiles = [...attachedFiles];
    const currentAcrChange = attachedAcrChange;
    if (inputRef.current) inputRef.current.value = "";
    setIsInputEmpty(true);
    setAttachedFiles([]);
    setAttachedAcrChange(null);

    const parts: any[] = [];
    if (userText) {
      if (currentAcrChange) {
        const acrContext = `[Discussing Proposal: "${currentAcrChange.changeTitle}" | Name: "${currentAcrChange.name}" | Arguments: ${JSON.stringify(currentAcrChange.args)}]\n\n${userText}`;
        parts.push({ text: acrContext });
      } else {
        parts.push({ text: userText });
      }
    }
    currentFiles.forEach((file) => {
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.base64,
        },
        _filename: file.name,
        _filesize: file.size,
        _extractedText: file.extractedText,
      });
    });

    // Add user message via functional state update to ensure latest state
    let chatHistory = [
      ...messages,
      {
        role: "user",
        parts,
        _timestamp: new Date().toISOString(),
      } as any,
    ];
    if (activeSessionId) updateSessionMessages(activeSessionId, chatHistory);
    setIsLoading(true);

    await processAIRequest(chatHistory);
  };

  const handleRetry = async () => {
    if (isLoading) return;

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (
        lastMessage.role === "model" &&
        lastMessage.parts?.[0]?.text === "Out of quota, please try again later."
      ) {
        const chatHistoryWithoutError = messages.slice(0, -1);

        // Check if the previous message was a function response (meaning this was an approval acknowledgment)
        const lastValidMsg =
          chatHistoryWithoutError[chatHistoryWithoutError.length - 1];
        const isApprovalAck =
          lastValidMsg &&
          lastValidMsg.role === "user" &&
          lastValidMsg.parts?.some((p) => p.functionResponse);

        if (activeSessionId)
          updateSessionMessages(activeSessionId, chatHistoryWithoutError);
        setIsLoading(true);
        await processAIRequest(chatHistoryWithoutError, !!isApprovalAck);
      }
    }
  };

  const handleEditSubmit = async (index: number) => {
    if (isLoading) return;
    const targetMessage = messages[index];
    if (!targetMessage) return;

    const updatedParts = targetMessage.parts ? [...targetMessage.parts] : [];

    const textPartIndex = updatedParts.findIndex((p) => p.text && !p.thought);
    if (textPartIndex !== -1) {
      updatedParts[textPartIndex] = {
        ...updatedParts[textPartIndex],
        text: editingMessageText.trim(),
      };
    } else if (editingMessageText.trim()) {
      updatedParts.unshift({ text: editingMessageText.trim() });
    }

    const updatedMessage = {
      ...targetMessage,
      parts: updatedParts,
    };

    const truncatedHistory = [...messages.slice(0, index), updatedMessage];

    if (activeSessionId) {
      updateSessionMessages(activeSessionId, truncatedHistory);
    }

    setEditingMessageIndex(null);
    setEditingMessageText("");
    setIsLoading(true);
    await processAIRequest(truncatedHistory);
  };

  const processAIRequest = async (
    currentHistory: Content[],
    isApprovalAck = false,
  ) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    try {
      if (
        activeSessionId &&
        activeSession?.title === "New Conversation" &&
        currentHistory.filter((m) => m.role === "user").length === 1
      ) {
        // Async generate title
        (async () => {
          try {
            const response = await gemini.models.generateContent({
              model: MODELS.FAST,
              contents: `Summarize this user prompt into a short 2-4 word title for a chat thread. Provide ONLY the title text without quotes:\n\n${currentHistory[0].parts?.[0]?.text}`,
            });
            const newTitle =
              response.text?.replace(/["']/g, "").trim() || "New Conversation";
            renameSession(activeSessionId, newTitle);
          } catch (e) {
            console.error("Failed to generate title", e);
          }
        })();
      }

      // Built now, from the project as it is at the moment of sending.
      const systemContext = buildAIContextString(activeProjectId, activeSessionId, isBillingEnabled);

      const invalidFuncCalls = new Set<string>();
      currentHistory.forEach((m) => {
        (m.parts || []).forEach((p) => {
          if (p.functionCall) {
            let sig = p.thoughtSignature || (p as any).thought_signature;
            if (
              !sig ||
              typeof sig !== "string" ||
              sig.startsWith("default_") ||
              sig.startsWith("legacy_") ||
              !sig.match(/^[A-Za-z0-9\+\/\-_]+={0,2}$/)
            ) {
              invalidFuncCalls.add(
                p.functionCall.name + (p.functionCall.id || ""),
              );
            }
          }
        });
      });

      // Clean history for the model: ensure explicit roles and proper mime type handling
      const cleanHistory = currentHistory
        .map((m, idx) => {
          const transformedParts: any[] = [];
          const hasNextResponse = currentHistory[idx + 1]?.parts?.some(
            (p) => p.functionResponse,
          );

          (m.parts || []).forEach((p) => {
            if (p.thought) {
              // INTENTIONAL DESIGN: Pass thoughts natively so the model can see its historical reasoning context.
              // Do not use literal <thought> strings to prevent the model from imitating them.
              const thoughtPart: any = { text: p.text || "", thought: true };
              const sig = p.thoughtSignature || (p as any).thought_signature;
              if (
                sig &&
                typeof sig === "string" &&
                sig.match(/^[A-Za-z0-9\+\/\-_]+={0,2}$/)
              ) {
                thoughtPart.thoughtSignature = sig;
              }
              transformedParts.push(thoughtPart);
              return;
            }

            const cleanPart = { ...p };

            if (cleanPart.functionCall) {
              if (!hasNextResponse) {
                // Convert pending/unanswered function call to plain text descriptive block
                transformedParts.push({
                  text: `\n[Proposed System Action (Pending User Review): ${cleanPart.functionCall.name} - ${JSON.stringify(cleanPart.functionCall.args || {})}]`,
                });
                return;
              }
              const funcKey =
                cleanPart.functionCall.name + (cleanPart.functionCall.id || "");
              if (invalidFuncCalls.has(funcKey)) {
                transformedParts.push({
                  text: `[Action Taken: ${cleanPart.functionCall.name} - ${JSON.stringify(cleanPart.functionCall.args || {})}]`,
                });
                return;
              }
              let sig =
                cleanPart.thoughtSignature ||
                (cleanPart as any).thought_signature;
              cleanPart.thoughtSignature = sig;
              delete (cleanPart as any).thought_signature;
              delete cleanPart.thought;
            }

            if (cleanPart.functionResponse) {
              const funcKey =
                cleanPart.functionResponse.name +
                (cleanPart.functionResponse.id || "");
              if (invalidFuncCalls.has(funcKey)) {
                const responseText =
                  typeof cleanPart.functionResponse.response === "object"
                    ? JSON.stringify(cleanPart.functionResponse.response)
                    : String(cleanPart.functionResponse.response || "");
                transformedParts.push({
                  text: `[Action Response: ${responseText}]`,
                });
                return;
              }
            }

            if (cleanPart.inlineData) {
              const mimeType =
                cleanPart.inlineData.mimeType || "application/octet-stream";

              if (isNativelySupportedForInlineData(mimeType)) {
                // PDF, images, video, audio are natively supported by Gemini
                transformedParts.push(cleanPart);
              } else {
                // Unsupported / complex formats (Word, Excel, code, text, CSV etc.)
                const customPart = cleanPart as any;
                const filename = customPart._filename || "attached_file";
                const filesize = customPart._filesize
                  ? formatFileSize(customPart._filesize)
                  : "Unknown size";
                const fileContent =
                  customPart._extractedText ||
                  "(No readable text content found in file)";

                const textBlock =
                  `[Attached File: ${filename} (${filesize})]\n` +
                  `----------------------------------------\n` +
                  `${fileContent}\n` +
                  `----------------------------------------`;

                transformedParts.push({
                  text: textBlock,
                });
              }
            } else {
              transformedParts.push(cleanPart);
            }
          });

          return {
            role:
              m.role ||
              (m.parts?.some((p) => p.functionResponse) ? "user" : "model"),
            parts: transformedParts,
          };
        })
        .filter((m) => m.parts.length > 0);

      const sanitizedHistory = activeProjectId
        ? sanitizeContentHistory(cleanHistory, activeProjectId)
        : cleanHistory;

      const sanitizedSystemContext = activeProjectId
        ? sanitizeString(
            systemContext,
            usePIIStore
              .getState()
              .entries.filter((e) => e.projectId === activeProjectId),
          )
        : systemContext;

      if (signal.aborted) {
        setIsLoading(false);
        setStreamingMessage(null);
        return;
      }

      const responseStream = await ai.models.generateContentStream({
        model: MODELS.REASONING,
        contents: sanitizedHistory,
        config: {
          abortSignal: signal,
          systemInstruction: isApprovalAck
            ? sanitizedSystemContext +
              "\n\nCRITICAL INSTRUCTION: You are responding to an action approval. DO NOT output <thought> tags or simulate any internal thinking process. Provide ONLY the direct conversational response."
            : sanitizedSystemContext,
          tools: [
            {
              functionDeclarations: [
                addTimelineRowDecl,
                discardPendingACRChangeDecl,
                updateTimelineRowDecl,
                deleteTimelineRowDecl,
                reorderTimelineRowDecl,
                createTimelineBaselineDecl,
                setTimelineHolidaysDecl,
                createCodexFolderDecl,
                createCodexPageDecl,
                updateCodexPageDecl,
                addDeliverableDecl,
                updateDeliverableDecl,
                deleteDeliverableDecl,
                addDeliverableCommentDecl,
                editDeliverableCommentDecl,
                archiveDeliverableDecl,
                unarchiveDeliverableDecl,
                addTaskDecl,
                updateTaskDecl,
                deleteTaskDecl,
                addTaskCommentDecl,
                editTaskCommentDecl,
                flagTaskDecl,
                unflagTaskDecl,
                archiveTaskDecl,
                unarchiveTaskDecl,
                addProjectRiskDecl,
                updateProjectRiskDecl,
                deleteProjectRiskDecl,
                archiveProjectRiskDecl,
                unarchiveProjectRiskDecl,
                addDocumentDecl,
                updateDocumentDecl,
                deleteDocumentDecl,
                addStakeholderDecl,
                updateStakeholderDecl,
                deleteStakeholderDecl,
                createMoMDecl,
                updateMomDecl,
                deleteMomDecl,
                updateMeetingDraftDecl,
                readCodexPageDecl,
                getArchivedItemsDecl,
                getTaskDetailsDecl,
                getDeliverableDetailsDecl,
                getTimelineRowDetailsDecl,
                getRiskDetailsDecl,
                getStakeholderDetailsDecl,
                getMomDetailsDecl,
              ],
            },
          ],
          ...(isApprovalAck
            ? {}
            : {
                thinkingConfig: {
                  thinkingLevel: thinkingLevel,
                  includeThoughts: true,
                },
              }),
        },
      });

      let mergedParts: any[] = [];
      let functionCalls: FunctionCall[] = [];
      const startTime = Date.now();
      let lastThoughtTime = startTime;
      let hasThought = false;

      for await (const chunk of responseStream) {
        if (signal.aborted) break;

        const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
        for (const p of chunkParts) {
          if (p.thought) {
            hasThought = true;
            lastThoughtTime = Date.now();
          }
          if (p.functionCall) {
            if (!p.functionCall.id)
              p.functionCall.id = `fc_${Math.random().toString(36).substr(2, 9)}`;

            // Ensure we copy the thoughtSignature from the nearest thought part
            if (!p.thoughtSignature && !(p as any).thought_signature) {
              for (let i = mergedParts.length - 1; i >= 0; i--) {
                if (
                  mergedParts[i].thoughtSignature ||
                  mergedParts[i].thought_signature
                ) {
                  p.thoughtSignature =
                    mergedParts[i].thoughtSignature ||
                    mergedParts[i].thought_signature;
                  break;
                }
              }
            }

            mergedParts.push(p);
            functionCalls.push(p.functionCall);
          } else {
            const isThought = !!p.thought;
            const lastMerged = mergedParts[mergedParts.length - 1];

            if (
              lastMerged &&
              !!lastMerged.thought === isThought &&
              !lastMerged.functionCall
            ) {
              lastMerged.text += p.text || "";
              if (p.thoughtSignature) {
                lastMerged.thoughtSignature = p.thoughtSignature;
              }
            } else {
              mergedParts.push({
                text: p.text || "",
                ...(isThought ? { thought: true } : {}),
                ...(p.thoughtSignature
                  ? { thoughtSignature: p.thoughtSignature }
                  : {}),
              });
            }
          }
        }

        if (signal.aborted) break;

        const payloadParts = activeProjectId
          ? reconstructParts(mergedParts, activeProjectId)
          : mergedParts;
        setStreamingMessage({
          role: "model",
          parts: payloadParts,
          _timestamp: new Date().toISOString(),
          _model: MODELS.REASONING,
          _thoughtDurationSeconds: hasThought ? Math.max(1, Math.round((lastThoughtTime - startTime) / 1000)) : undefined,
        } as any);
      }

      if (signal.aborted) {
        setStreamingMessage(null);
        if (mergedParts.length > 0) {
          const reconstructedPartsList = activeProjectId
            ? reconstructParts(mergedParts, activeProjectId)
            : mergedParts;
          const stoppedModelContent: Content = {
            role: "model",
            parts: reconstructedPartsList,
            _timestamp: new Date().toISOString(),
            _model: MODELS.REASONING,
            _thoughtDurationSeconds: hasThought ? Math.max(1, Math.round((lastThoughtTime - startTime) / 1000)) : undefined,
          } as any;
          if (activeSessionId) {
            updateSessionMessages(activeSessionId, [
              ...currentHistory,
              stoppedModelContent,
            ]);
          }
        }
        return;
      }

      const reconstructedPartsList = activeProjectId
        ? reconstructParts(mergedParts, activeProjectId)
        : mergedParts;

      const newModelContent: Content = {
        role: "model",
        parts: reconstructedPartsList,
        _timestamp: new Date().toISOString(),
        _model: MODELS.REASONING,
        _thoughtDurationSeconds: hasThought ? Math.max(1, Math.round((lastThoughtTime - startTime) / 1000)) : undefined,
      } as any;

      setStreamingMessage(null);
      const updatedHistory = [...currentHistory, newModelContent];
      if (activeSessionId)
        updateSessionMessages(activeSessionId, updatedHistory);

      if (functionCalls.length > 0 && !signal.aborted) {
        const finalFunctionCalls = reconstructedPartsList
          .filter((p) => !!p.functionCall)
          .map((p) => p.functionCall!);

        finalFunctionCalls.forEach(fc => {
          if (fc.args) {
            useIdAliasStore.getState().replaceAliasWithReal(fc.args);
          }
        });

        const queryCalls = finalFunctionCalls.filter((fc) =>
          QUERY_TOOL_NAMES.includes(fc.name),
        );
        let mutationCalls = finalFunctionCalls.filter(
          (fc) => !QUERY_TOOL_NAMES.includes(fc.name),
        );

        let autoResponses: any[] = [];

        // 1. Instantly resolve Query tools against local state
        if (queryCalls.length > 0) {
          queryCalls.forEach((qc) => {
            let responseData: any = { error: "Item not found." };
            try {
              if (qc.name === "readCodexPage") {
                const found = projectCodexPages.find((p) => p.id === qc.args?.id);
                if (found && isCodexFolder(found)) {
                  // A folder is read as the list of its pages.
                  responseData = {
                    id: found.id,
                    title: found.title,
                    isFolder: true,
                    note: "This is a folder. It holds pages and has no content of its own. Read a page by its id.",
                    pages: projectCodexPages
                      .filter((p) => p.parentId === found.id)
                      .map((p) => ({ id: p.id, title: p.title })),
                    ...(String(found.content || "").trim() ? { olderFolderNotes: found.content } : {}),
                  };
                } else {
                  responseData = found || responseData;
                }
              } else if (qc.name === "getArchivedItems") {
                responseData = readArchivedModule(
                  String(qc.args?.module || "tasks"),
                  activeProjectId || undefined,
                  { query: qc.args?.query as any, limit: qc.args?.limit as any },
                );
              } else if (qc.name === "getTaskDetails") {
                // Read from the whole store, not from projectTasks: that list is
                // active tasks only now, and an id the model is holding must
                // always resolve. The record carries isArchived, so the model can
                // see for itself that it has to restore before changing it.
                responseData =
                  useTasksStore
                    .getState()
                    .tasks.find(
                      (t) => t.id === qc.args?.id && t.projectId === activeProjectId,
                    ) || responseData;
              } else if (qc.name === "getDeliverableDetails") {
                const found = projectDeliverables.find((d) => d.id === qc.args?.id);
                if (found) {
                  const nestedChildren = projectDeliverables.filter((c) => c.parentId === found.id);
                  responseData = {
                    ...found,
                    nestedDeliverablesCount: nestedChildren.length,
                    nestedDeliverables: nestedChildren.map((c) => ({
                      id: c.id,
                      title: c.title,
                      status: c.status,
                      owner: c.owner || "Unassigned",
                      dueDate: c.dueDate,
                      priority: c.priority || "Medium",
                      hasNestedSpace: !!c.hasNestedSpace,
                    })),
                  };
                } else {
                  responseData = { error: "Deliverable not found." };
                }
              } else if (qc.name === "getTimelineRowDetails") {
                const revId =
                  qc.args?.revisionId || projectTimeline?.activeRevisionId;
                const baseline = projectTimeline?.revisions.find(
                  (r) => r.id === revId,
                );
                responseData =
                  baseline?.activities.find((a: any) => a.id === qc.args?.id) ||
                  responseData;
              } else if (qc.name === "getRiskDetails") {
                // Whole store, like getTaskDetails: projectRisks is active only
                // now, and an id the model is holding must always resolve.
                responseData =
                  useRisksStore
                    .getState()
                    .risks.find(
                      (r) => r.id === qc.args?.id && r.projectId === activeProjectId,
                    ) || responseData;
              } else if (qc.name === "getStakeholderDetails") {
                responseData =
                  projectStakeholders.find((s) => s.id === qc.args?.id) ||
                  responseData;
              } else if (qc.name === "getMomDetails") {
                const foundMom = projectMoms.find((m) => m.id === qc.args?.id);
                if (foundMom) {
                  responseData = {
                    ...foundMom,
                    actionItems: (foundMom.actionItems || []).map((ai: any) => {
                      const linkedTask = (ai.taskId && ai.taskId !== 'pushed')
                        ? projectTasks.find((t) => t.id === ai.taskId)
                        : null;
                      return {
                        ...ai,
                        status: linkedTask ? linkedTask.status : (ai.status || 'Open'),
                      };
                    }),
                  };
                } else {
                  responseData = { error: "MoM record not found." };
                }
              }
            } catch (err: any) {
              responseData = { error: err.message };
            }

            autoResponses.push({
              functionResponse: {
                id: qc.id,
                name: qc.name,
                response: responseData,
              },
            });
          });
        }

        // 2a. The Codex rules (a folder holds pages, a page sits in a folder).
        // A call that breaks them is answered at once with what to send, and
        // never reaches the review panel. Same check as Claude's, in
        // utils/codexRules.ts.
        const refusedCalls = mutationCalls
          .map((c) => ({ call: c, problem: checkCodexChange(c.name, c.args, activeProjectId) }))
          .filter((r) => !!r.problem);
        refusedCalls.forEach(({ call, problem }) => {
          autoResponses.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { status: "refused", message: `Not proposed. ${problem}` },
            },
          });
        });
        mutationCalls = mutationCalls.filter((c) => !refusedCalls.some((r) => r.call === c));

        // 2. Queue Mutation tools to the ACR
        if (mutationCalls.length > 0 && activeProjectId && activeSessionId) {
          const rawChanges = mutationCalls.map((c) => ({
            callId: c.id,
            name: c.name,
            args: c.args,
          }));

          const newAcrId = useAcrStore
            .getState()
            .createAcr(activeProjectId, activeSessionId, rawChanges);
          // Calls the store would not apply because they reached for a line
          // the user edited (utils/acrUserEdits.ts). Each gets its own
          // "refused" answer, with the user's version in it.
          const editRefusals = takeAcrMergeRefusals();
          const refusalFor = (fc: any) => editRefusals.find((r) => r.callId === fc.id);
            
          if (newAcrId) {
            useAcrStore.getState().setActiveAcrId(newAcrId);
          }

          autoResponses.push(
            ...mutationCalls.map((fc) => refusalFor(fc) ? ({
              functionResponse: {
                id: fc.id,
                name: fc.name,
                response: {
                  status: "refused",
                  message: `Not applied. ${refusalFor(fc)!.message} Tell the user what you tried to change and why it was not applied.`,
                },
              },
            }) : ({
              functionResponse: {
                id: fc.id,
                name: fc.name,
                response: {
                  status:
                    fc.name === "discardPendingACRChange"
                      ? "success"
                      : "proposed_pending_review",
                  message:
                    fc.name === "discardPendingACRChange"
                      ? `The proposed change was successfully removed from the pending ACR. Please inform the user.`
                      : newAcrId 
                        ? `This action has been successfully proposed as a pending Assistant Change Request (ACR) under ID "${newAcrId}". Please inform the user what changes have been proposed, tell them they can sign off or review them on the right side pane, and ask if they have any comments or other requests.`
                        : `This action hit a conflict and no ACR was created.`,
                },
              },
            })),
          );
        }

        if (autoResponses.length > 0 && activeSessionId && !signal.aborted) {
          const followupUserContent: Content = {
            role: "user",
            parts: autoResponses,
            _timestamp: new Date().toISOString(),
          } as any;

          const updatedHistoryWithResponse = [
            ...updatedHistory,
            followupUserContent,
          ];
          updateSessionMessages(activeSessionId, updatedHistoryWithResponse);

          // Trigger continuation of the AI response automatically without halting
          setTimeout(() => {
            if (!signal.aborted) {
              processAIRequest(updatedHistoryWithResponse);
            }
          }, 200);
          return;
        }
      }
    } catch (e: any) {
      console.error(e);
      const isAborted =
        signal?.aborted ||
        e.name === "AbortError" ||
        e.message?.includes("abort") ||
        e.message?.includes("canceled") ||
        e.message?.includes("cancelled");

      if (isAborted) {
        setStreamingMessage(null);
        setIsLoading(false);
        return;
      }

      // Optional: Handle error message insertion
      if (
        activeSessionId &&
        !isAborted
      ) {
        let errorMsg = `Sorry, I encountered an error communicating with the Codex brain. ${geminiErrorText(e)}`;
        if (isGeminiKeyMissing(e)) {
          errorMsg = geminiErrorText(e);
        } else if (
          e.status === 429 ||
          e.message?.includes("429") ||
          e.message?.includes("RESOURCE_EXHAUSTED") ||
          e.message?.includes("quota")
        ) {
          errorMsg = "Out of quota, please try again later.";
        }
        updateSessionMessages(activeSessionId, [
          ...currentHistory,
          { role: "model", parts: [{ text: errorMsg }] } as Content,
        ]);
      }
    } finally {
      setIsLoading(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const executeBatch = async (
    callsToExecute: {
      id: string;
      call: FunctionCall;
      name: string;
      args: any;
    }[],
    action: "approved" | "rejected" | "edited",
    message: string,
  ) => {
    setPendingBatch(null);
    setIsReviewModalOpen(false);

    let responses: any[] = [];

    if (action === "rejected") {
      responses = callsToExecute.map((c) => ({
        functionResponse: {
          id: c.call.id,
          name: c.name,
          response: { result: "User rejected this action." },
        },
      }));
    } else {
      // Execute the actions
      callsToExecute.forEach((c) => {
        let resultMsg = "";
        let beforeData: any = null;
        let afterData: any = null;
        try {
          // One shared executor, for this path and the two sign-off paths.
          // See src/services/acrExecutor.ts for why they were merged.
          const outcome = applyProjectChange(c.name, c.args, activeProjectId);
          resultMsg = outcome.message;
          beforeData = outcome.beforeData ?? null;
          afterData = outcome.afterData ?? null;
        } catch (err: any) {
          let errMsg = err.message;
          if (
            err.status === 429 ||
            err.message?.includes("429") ||
            err.message?.includes("RESOURCE_EXHAUSTED") ||
            err.message?.includes("quota")
          ) {
            errMsg = "Out of quota, please try again later.";
          }
          resultMsg = `Error: ${errMsg}`;
        }

        responses.push({
          functionResponse: {
            id: c.call.id,
            name: c.name,
            response: {
              result:
                action === "edited"
                  ? `User approved with modifications. ${resultMsg}`
                  : `User approved without modifications. ${resultMsg}`,
              beforeData,
              afterData,
            },
          },
        });
      });
    }

    const chatHistory = [
      ...messages,
      { role: "user", parts: responses } as Content,
    ];
    if (activeSessionId) updateSessionMessages(activeSessionId, chatHistory);
    setIsLoading(true);
    await processAIRequest(chatHistory, true);
  };

  // The review panel used to follow the global pointer with no session filter,
  // so one open request appeared in EVERY chat. A request belongs to the chat
  // that asked for it; switching chats must leave it behind.
  //
  // A request from Claude belongs to no chat at all — Claude has no
  // conversation in this app — so it is reachable from anywhere, and the header
  // bar is what opens it. See AGENTS.md.
  const activeAcr = useAcrStore((state) =>
    state.acrs.find(
      (a) =>
        a.status === "pending" &&
        a.id === activeAcrId &&
        (((a as any).origin || "gemini") === "claude" ||
          a.sessionId === activeSessionId),
    ),
  );

  /**
   * The review panel is its own surface, not a strip beside the chat.
   *
   * A request Claude filed belongs to no conversation, so the chat next to it
   * is noise — the panel opens on its own and fills the pane. A request Gemini
   * filed came out of a conversation the user is reading, so that one keeps the
   * chat until the user asks otherwise. Either way the toggle in the review
   * header decides, and the flag is only ever read while a review is open.
   */
  const hideChatForReview = !!activeAcr && isChatHiddenDuringReview;
  const activeAcrOrigin = (activeAcr as any)?.origin || "gemini";
  const lastAutoHiddenAcrRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeAcr) {
      // Nothing under review: never leave the chat hidden.
      if (isChatHiddenDuringReview) setIsChatHiddenDuringReview(false);
      lastAutoHiddenAcrRef.current = null;
      return;
    }
    // Choose a sensible default once per request, then leave the user's choice
    // alone for as long as that request stays open.
    if (lastAutoHiddenAcrRef.current === activeAcr.id) return;
    lastAutoHiddenAcrRef.current = activeAcr.id;
    setIsChatHiddenDuringReview(activeAcrOrigin === "claude");
  }, [activeAcr, activeAcrOrigin, isChatHiddenDuringReview, setIsChatHiddenDuringReview]);

  const handleFocusChange = (change: any) => {
    setActiveAcrChangeId(change.id);
    setAttachedAcrChange(change);
    const targetPath = getModulePathForTool(change.name);
    if (targetPath) {
      navigate(targetPath);
    }
  };

  const handleApproveAcr = () => {
    if (!activeAcr) return;
    const approvedChanges = activeAcr.changes.filter((c) => c.approved);

    approvedChanges.forEach((change) => {
      const { name, args } = change;
      try {
        // The same executor the other two paths use. Before this, the three
        // copies disagreed on the defaults they wrote, so the same proposal
        // produced a different record depending on which button you pressed.
        applyProjectChange(name, args, activeProjectId);
      } catch (err) {
        console.error("Error executing action:", name, err);
      }
    });

    setAcrStatus(activeAcr.id, "approved");
    setActiveAcrId(null);
    setEditingChangeId(null);

    const rejectedChanges = activeAcr.changes.filter((c) => !c.approved);

    // A change request Claude proposed is not Gemini's to answer. Sending the
    // sign-off into this chat would make Gemini reply about work it never did.
    // The bridge tells Claude instead; nothing is needed here.
    // No import: this file is often rewritten, and a missing field must never
    // break the build. See AGENTS.md.
    if (((activeAcr as any).origin || "gemini") === "claude") {
      return;
    }

    const userFeedbackPart = `The user reviewed the proposed Assistant Change Request (ACR) and signed off!
Status of changes:
${approvedChanges.map((c) => `- APPROVED & APPLIED: "${c.changeTitle}" (Action: ${c.name}). Action arguments applied: ${JSON.stringify(c.args)}`).join("\n")}
${rejectedChanges.map((c) => `- REJECTED & DISCARDED: "${c.changeTitle}"`).join("\n")}

Please provide a conversational response acknowledging the sign-off, summarizing what was approved/applied (and specifically highlight details of any parameters that the user edited/modified before signing off!). Use pristine professional tone.`;

    const feedbackMsg: Content = {
      role: "user",
      parts: [{ text: userFeedbackPart }],
      _timestamp: new Date().toISOString(),
      _isHidden: true,
    } as any;

    const chatHistory = [...messages, feedbackMsg];
    if (activeSessionId) {
      updateSessionMessages(activeSessionId, chatHistory);
    }
    setIsLoading(true);
    processAIRequest(chatHistory, true);
  };

  const handleRejectAcr = () => {
    if (!activeAcr) return;
    setAcrStatus(activeAcr.id, "rejected");
    setActiveAcrId(null);
    setEditingChangeId(null);

    // A change request Claude proposed is not Gemini's to answer. Sending the
    // sign-off into this chat would make Gemini reply about work it never did.
    // The bridge tells Claude instead; nothing is needed here.
    // No import: this file is often rewritten, and a missing field must never
    // break the build. See AGENTS.md.
    if (((activeAcr as any).origin || "gemini") === "claude") {
      return;
    }

    const userFeedbackPart = `The user reviewed the proposed Assistant Change Request (ACR) and rejected the entire proposal.
Rejected proposed changes:
${activeAcr.changes.map((c) => `- REJECTED: "${c.changeTitle}" (Action type: ${c.name})`).join("\n")}

All proposed changes have been completely discarded/cancelled. Please provide a conversational response acknowledging the rejection of these changes, and ask the user how they would like to proceed or what alternative adjustments they need.`;

    const feedbackMsg: Content = {
      role: "user",
      parts: [{ text: userFeedbackPart }],
      _timestamp: new Date().toISOString(),
      _isHidden: true,
    } as any;

    const chatHistory = [...messages, feedbackMsg];
    if (activeSessionId) {
      updateSessionMessages(activeSessionId, chatHistory);
    }
    setIsLoading(true);
    processAIRequest(chatHistory, true);
  };

  const hasStreamingContent = streamingMessage
    ? (streamingMessage.parts || [])
        .filter((p) => !p.thought)
        .some((p) => p.text)
    : false;

  const avatarState: "idle" | "thinking" | "responding" = streamingMessage
    ? hasStreamingContent
      ? "responding"
      : "thinking"
    : isLoading
      ? "thinking"
      : "idle";

  return (
    <div
      ref={containerRef}
      className="w-full min-w-0 flex h-full bg-qb-bg relative"
    >
      {/* Left Chat Pane. Hidden, not unmounted, while a review holds the pane:
          unmounting would throw away scroll position, a half-typed message and
          any file the user had attached. */}
      <div
        className={`${hideChatForReview ? "hidden" : "flex"} flex-col h-full bg-qb-bg flex-1 min-w-0 p-0 relative border-r border-[#d1d5db] last:border-r-0`}
      >
        {/* Header */}
        <div className="sidebar-content flex flex-row items-center px-6 border-b border-[#d1d5db] shrink-0 bg-qb-bg relative z-20 py-3 gap-4">
          <AIAvatar
            state={avatarState}
            className="w-11 h-11 rounded-sm shrink-0"
          />
          <div className="flex flex-col flex-1 min-w-0 justify-center gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center text-qb-black font-black uppercase tracking-widest text-sm">
                <span>Assistant</span>
              </div>
              <button
                onClick={onClose}
                className="lg:hidden p-1.5 hover:bg-qb-light-grey/30 text-qb-grey hover:text-qb-black transition-colors -mr-2 shadow-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Session Selector */}
            <div className="relative w-full">
              <div
                onClick={() => setIsSessionDropdownOpen(!isSessionDropdownOpen)}
                className="flex items-center justify-between cursor-pointer hover:text-qb-orange transition-colors group"
              >
                <span className="text-[10px] font-black text-qb-grey uppercase tracking-widest flex items-center gap-1.5 group-hover:text-qb-orange transition-colors truncate pr-2">
                  <MessageSquare className="w-3 h-3" />
                  {activeSession?.title || "NEW CONVERSATION"}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeProjectId) createSession(activeProjectId);
                      setIsSessionDropdownOpen(false);
                    }}
                    className="p-1 text-qb-grey hover:text-qb-black transition-colors bg-transparent border-none outline-none focus:outline-none"
                    title="New Session"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {isSessionDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-3 -mx-2 bg-qb-bg z-30 border border-qb-light-grey shadow-md flex flex-col max-h-72 overflow-y-auto">
                  {aiSessions.length > 0 && aiSessions.some(s => s.projectId && s.projectId !== activeProjectId) && (
                    <div className="flex border-b border-qb-light-grey bg-qb-box-bg/50 p-1 gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSessionFilterTab('project')}
                        className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
                          sessionFilterTab === 'project'
                            ? 'bg-qb-orange text-white'
                            : 'text-qb-grey hover:text-qb-black'
                        }`}
                      >
                        Project ({aiSessions.filter((s) => !activeProjectId || !s.projectId || s.projectId === "" || s.projectId === activeProjectId).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSessionFilterTab('all')}
                        className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
                          sessionFilterTab === 'all'
                            ? 'bg-qb-orange text-white'
                            : 'text-qb-grey hover:text-qb-black'
                        }`}
                      >
                        All Chats ({aiSessions.length})
                      </button>
                    </div>
                  )}

                  {aiSessions
                    .filter((s) => {
                      if (sessionFilterTab === 'all') return true;
                      return !activeProjectId || !s.projectId || s.projectId === "" || s.projectId === activeProjectId;
                    })
                    .map((s) => (
                      <div
                        key={s.id}
                        className={`group relative flex items-center justify-between px-4 py-3 text-xs font-black uppercase tracking-widest transition-colors ${activeSessionId === s.id ? "text-qb-orange bg-qb-orange/10" : "text-qb-dark-grey border-b border-qb-light-grey last:border-b-0 hover:bg-qb-light-grey/30"}`}
                      >
                        {editingSessionId === s.id ? (
                          <div className="flex-1 flex gap-2">
                            <input
                              type="text"
                              value={editingSessionTitle}
                              onChange={(e) =>
                                setEditingSessionTitle(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  renameSession(
                                    s.id,
                                    editingSessionTitle || "New Conversation",
                                  );
                                  setEditingSessionId(null);
                                } else if (e.key === "Escape") {
                                  setEditingSessionId(null);
                                }
                              }}
                              autoFocus
                              className="flex-1 bg-transparent border border-qb-light-grey text-qb-black text-xs px-2 py-1 outline-none"
                            />
                            <button
                              onClick={() => {
                                renameSession(
                                  s.id,
                                  editingSessionTitle || "New Conversation",
                                );
                                setEditingSessionId(null);
                              }}
                              className="text-qb-orange"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div
                              className="flex-1 cursor-pointer truncate mr-2"
                              onClick={() => {
                                setActiveSessionId(s.id);
                                setIsSessionDropdownOpen(false);
                              }}
                            >
                              <div className="truncate">
                                {s.title === "New Conversation" &&
                                s.messages?.find((m) => m.role === "user")
                                  ?.parts?.[0]?.text
                                  ? s.messages
                                      .find((m) => m.role === "user")
                                      ?.parts?.[0]?.text.substring(0, 20) +
                                    "..."
                                  : s.title}
                              </div>
                              <div className="text-[10px] text-qb-light-grey font-mono mt-1 flex items-center justify-between">
                                <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
                                <span className="text-[9px] text-qb-grey">
                                  {s.messages?.length || 0} msgs
                                </span>
                              </div>
                            </div>

                            <div className="hidden group-hover:flex items-center gap-2 shrink-0 bg-transparent">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingSessionTitle(s.title);
                                  setEditingSessionId(s.id);
                                }}
                                className="text-qb-grey hover:text-qb-orange transition-colors"
                                title="Rename"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSessionToDelete(s.id);
                                }}
                                className="text-qb-grey hover:text-red-500 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                  {aiSessions.length === 0 && (
                    <div className="px-4 py-3 text-[11px] text-qb-grey font-mono uppercase tracking-wider text-center">
                      No chat history found
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Empty state prompt templates picker */}
          {messages.length === 0 && (
            <div className="flex flex-col gap-5 my-auto py-2">
              {/* Header */}
              <div className="flex flex-col gap-1 border-b border-qb-light-grey pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-qb-orange shrink-0" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-qb-black">
                      SELECT A PROMPT TEMPLATE
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate('/settings?tab=templates');
                    }}
                    className="text-[10px] font-black uppercase tracking-wider text-qb-grey hover:text-qb-orange transition-colors flex items-center gap-1 cursor-pointer"
                    title="Configure templates in Settings"
                  >
                    <SettingsIcon className="w-3 h-3" />
                    <span>CONFIGURE</span>
                  </button>
                </div>
                <p className="text-[11px] font-medium text-qb-dark-grey leading-relaxed">
                  Choose a prompt template below to jumpstart your analysis or type a custom query.
                </p>
              </div>

              {/* Category Quick Filter */}
              <div className="flex flex-wrap gap-1.5">
                {(['All', 'Timeline', 'Risks', 'MoM', 'Deliverables', 'Tasks', 'Billing', 'General'] as const).map((cat) => {
                  const isSelected = templateCategoryFilter === cat;
                  const count = cat === 'All' 
                    ? promptTemplates.length 
                    : promptTemplates.filter((t) => t.category === cat).length;
                  if (count === 0 && cat !== 'All') return null;

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTemplateCategoryFilter(cat)}
                      className={`px-2.5 py-1 text-[10px] font-black tracking-wider uppercase border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-qb-black text-white border-qb-black shadow-xs'
                          : 'bg-white text-qb-dark-grey border-qb-light-grey hover:border-qb-black hover:text-qb-black'
                      }`}
                    >
                      <span>{cat}</span>
                    </button>
                  );
                })}
              </div>

              {/* Template Cards List */}
              <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto no-scrollbar pr-0.5">
                {promptTemplates
                  .filter((t) => templateCategoryFilter === 'All' || t.category === templateCategoryFilter)
                  .map((template) => {
                    const badgeColor = getCategoryBadgeColor(template.category);
                    return (
                      <div
                        key={template.id}
                        onClick={() => handleSelectTemplate(template)}
                        className="group relative border border-qb-light-grey bg-white p-3.5 flex flex-col gap-2 hover:border-qb-orange hover:bg-qb-orange/5 cursor-pointer transition-all shadow-xs text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 text-[8.5px] font-black uppercase tracking-widest border ${badgeColor}`}>
                            <span className="w-1 h-1 bg-current shrink-0" />
                            {template.category}
                          </span>
                          <span className="text-[9px] font-bold text-qb-grey group-hover:text-qb-orange uppercase tracking-wider flex items-center gap-1">
                            <span>USE</span>
                            <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
                          </span>
                        </div>

                        <h4 className="text-xs font-black uppercase tracking-wide text-qb-black group-hover:text-qb-orange transition-colors">
                          {template.title}
                        </h4>

                        {template.description && (
                          <p className="text-[11px] font-medium text-qb-dark-grey leading-relaxed line-clamp-2">
                            {template.description}
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Messages */}
          {groupMessagesIntoTurns(messages).map((turn) => {
            return (
              <div key={turn.id} className="flex flex-col gap-6 w-full">
                {/* 1. User Message (if any) */}
                {turn.userMessage &&
                  (() => {
                    const m = turn.userMessage;
                    const i = turn.userMessageIndex;
                    const executableParts =
                      m.parts?.filter((p: any) => !p.thought) || [];

                    return (
                      <div className="chat-message flex flex-col gap-2 items-end">
                        {editingMessageIndex === i ? (
                          <div className="relative group text-sm leading-relaxed p-4 border font-medium bg-qb-black text-white border-qb-black max-w-[85%] w-full">
                            <div className="flex flex-col gap-3 min-w-[200px]">
                              <textarea
                                value={editingMessageText}
                                onChange={(e) =>
                                  setEditingMessageText(e.target.value)
                                }
                                className="bg-zinc-950 text-white text-xs border border-white/20 px-3 py-2 outline-none font-medium resize-none min-h-[72px] focus:border-qb-orange transition-colors font-mono"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleEditSubmit(i);
                                  }
                                }}
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => {
                                    setEditingMessageIndex(null);
                                    setEditingMessageText("");
                                  }}
                                  className="px-2 py-1 border border-white/20 text-white/70 hover:text-white hover:border-white text-[10px] font-bold uppercase tracking-widest transition-colors font-sans"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleEditSubmit(i)}
                                  disabled={isLoading}
                                  className="px-2 py-1 bg-qb-orange text-white text-[10px] font-bold uppercase tracking-widest hover:bg-qb-orange/90 transition-colors disabled:opacity-50 font-sans"
                                >
                                  Retry
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="relative group text-sm leading-relaxed p-4 border font-medium bg-qb-black text-white border-qb-black max-w-[85%]">
                            <div className="flex flex-col gap-3 pr-6">
                              {executableParts.some((p: any) => p.text) && (
                                <div className="whitespace-pre-wrap">
                                  {executableParts
                                    .map((p: any) => p.text)
                                    .join("")
                                    .replace(/^\[Discussing Proposal: "[\s\S]*?" \| Name: "[\s\S]*?" \| Arguments: [\s\S]*?\]\n\n/, "")}
                                </div>
                              )}
                              {executableParts.filter((p: any) => p.inlineData)
                                .length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-1">
                                  {executableParts
                                    .filter((p: any) => p.inlineData)
                                    .map((fp: any, idx: number) =>
                                      renderFileAttachment(fp, idx, true),
                                    )}
                                </div>
                              )}
                              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => {
                                    setEditingMessageIndex(i);
                                    setEditingMessageText(
                                      executableParts
                                        .filter((p: any) => p.text)
                                        .map((p: any) => p.text)
                                        .join("")
                                        .replace(/^\[Discussing Proposal: "[\s\S]*?" \| Name: "[\s\S]*?" \| Arguments: [\s\S]*?\]\n\n/, ""),
                                    );
                                  }}
                                  className="p-1 text-qb-grey hover:text-qb-orange transition-colors focus:outline-none"
                                  title="Edit and retry conversation from this point"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            {(m as any)._timestamp && (
                              <div className="text-[9px] mt-2 opacity-50 flex gap-4 uppercase font-bold tracking-widest justify-end text-white">
                                <span>
                                  {new Date(
                                    (m as any)._timestamp,
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                {/* 2. Unified Cognitive Trace (if any) */}
                {turn.traceElements.length > 0 && (
                  <div className="chat-message flex flex-col gap-2 items-start w-full">
                    <AIExecutionChain traceElements={turn.traceElements} />
                  </div>
                )}

                {/* 3. Assistant Answers (if any) */}
                {turn.assistantResponses.map((act) => {
                  const m = act.message;
                  const i = act.index;
                  const executableParts = act.executableParts;

                  return (
                    <div
                      key={i}
                      className="chat-message flex flex-col gap-2 items-start w-full"
                    >
                      <div className="relative group text-sm leading-relaxed p-4 border font-medium bg-transparent border-qb-orange text-qb-black w-full overflow-hidden">
                        <div className="flex flex-col gap-3">
                          {executableParts.some((p: any) => p.text) && (
                            <AIResponseRenderer
                              content={executableParts
                                .map((p: any) => p.text)
                                .join("")}
                            />
                          )}
                          {executableParts.filter((p: any) => p.inlineData)
                            .length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {executableParts
                                .filter((p: any) => p.inlineData)
                                .map((fp: any, idx: number) =>
                                  renderFileAttachment(fp, idx, false),
                                )}
                            </div>
                          )}
                          {m.role === "model" &&
                            i === messages.length - 1 &&
                            executableParts.length === 1 &&
                            executableParts[0].text ===
                              "Out of quota, please try again later." && (
                              <button
                                onClick={handleRetry}
                                disabled={isLoading}
                                className="flex items-center gap-2 self-start bg-qb-orange text-white px-3 py-1.5 text-xs font-bold uppercase tracking-widest hover:bg-qb-orange/90 transition-colors disabled:opacity-50"
                              >
                                <RefreshCw
                                  size={14}
                                  className={isLoading ? "animate-spin" : ""}
                                />
                                Retry
                              </button>
                            )}
                        </div>
                        {(m as any)._timestamp && (
                          <div
                            className={`text-[9px] mt-2 opacity-50 flex gap-4 uppercase font-bold tracking-widest justify-between text-qb-black`}
                          >
                            <span>
                              {new Date(
                                (m as any)._timestamp,
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {m.role === "model" && (m as any)._model && (
                              <span>{(m as any)._model}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Streaming Message */}
          {streamingMessage &&
            (() => {
              const parts = streamingMessage.parts || [];
              const thoughtParts = parts.filter((p) => p.thought);
              const allFuncs = parts.filter((p) => p.functionCall);
              const queryFuncs = allFuncs.filter((p) =>
                QUERY_TOOL_NAMES.includes(p.functionCall!.name),
              );
              const mutationFuncs = allFuncs.filter(
                (p) => !QUERY_TOOL_NAMES.includes(p.functionCall!.name),
              );
              const hasTrace = thoughtParts.length > 0 || allFuncs.length > 0;
              const hasContent = parts
                .filter((p) => !p.thought)
                .some((p) => p.text);

              return (
                <div className="chat-message flex flex-col gap-2 items-start opacity-80 w-full animate-fade-in">
                  {hasTrace && (
                    <AIExecutionChain
                      isStreaming={true}
                      thoughtContent={
                        thoughtParts.length > 0
                          ? thoughtParts.map((p) => p.text).join("")
                          : undefined
                      }
                      thoughtTitle={
                        thoughtParts.find((p) => p.thoughtSignature)
                          ?.thoughtSignature || undefined
                      }
                      thoughtDurationSeconds={(streamingMessage as any)._thoughtDurationSeconds}
                      queryFuncs={queryFuncs}
                      mutationFuncs={mutationFuncs}
                    />
                  )}
                  {hasContent && (
                    <div className="text-sm leading-relaxed p-4 border font-medium bg-transparent border-qb-orange text-qb-black w-full overflow-hidden">
                      <AIResponseRenderer
                        content={parts
                          .filter((p) => !p.thought)
                          .map((p) => p.text)
                          .join("")}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
          {false && streamingMessage && (
            <div
              className={`chat-message flex flex-col gap-2 items-start opacity-80`}
            >
              {(streamingMessage.parts || []).filter((p) => p.thought).length >
                0 && (
                <ThoughtProcess
                  isStreaming={true}
                  content={(streamingMessage.parts || [])
                    .filter((p) => p.thought)
                    .map((p) => p.text)
                    .join("")}
                  title={
                    (streamingMessage.parts || [])
                      .filter((p) => p.thought && p.thoughtSignature)
                      .pop()?.thoughtSignature || undefined
                  }
                />
              )}
              {(streamingMessage.parts || []).filter((p) => !p.thought).length >
                0 &&
                (streamingMessage.parts || [])
                  .filter((p) => !p.thought)
                  .some((p) => p.text) && (
                  <div
                    className={`text-sm leading-relaxed p-4 border font-medium bg-transparent border-qb-orange text-qb-black w-full overflow-hidden`}
                  >
                    <AIResponseRenderer
                      content={(streamingMessage.parts || [])
                        .filter((p) => !p.thought)
                        .map((p) => p.text)
                        .join("")}
                    />
                  </div>
                )}
              {(streamingMessage.parts || []).filter((p) => p.functionCall)
                .length > 0 &&
                (() => {
                  const allFuncs = (streamingMessage.parts || []).filter(
                    (p) => p.functionCall,
                  );
                  const queryFuncs = allFuncs.filter((p) =>
                    QUERY_TOOL_NAMES.includes(p.functionCall!.name),
                  );
                  const mutationFuncs = allFuncs.filter(
                    (p) => !QUERY_TOOL_NAMES.includes(p.functionCall!.name),
                  );

                  return (
                    <>
                      {queryFuncs.length > 0 && (
                        <ThoughtProcess
                          isStreaming={true}
                          content={queryFuncs
                            .map(
                              (p) =>
                                `Querying ${p.functionCall!.name} with args: ${JSON.stringify(p.functionCall!.args || {})}`,
                            )
                            .join("\n")}
                          title="System Query Execution"
                        />
                      )}
                      {mutationFuncs.length > 0 && (
                        <ActionGroup functionCalls={mutationFuncs} />
                      )}
                    </>
                  );
                })()}
            </div>
          )}

          {/* Pending Actions */}
          {activeSessionId &&
            getPendingAcrForSession(activeSessionId) &&
            (() => {
              const pendingSessionAcr =
                getPendingAcrForSession(activeSessionId)!;
              return (
                <div className="sidebar-content border-2 border-qb-orange p-4 bg-transparent shadow-sm flex flex-col gap-3 shrink-0">
                  <div className="text-xs font-black uppercase tracking-widest text-qb-orange flex items-center gap-2">
                    <span className="animate-pulse flex h-2 w-2 rounded-full bg-qb-orange"></span>
                    {pendingSessionAcr.changes.length} SYSTEM MODIFICATION(S)
                    PROPOSED
                  </div>

                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => {
                        const approvedChanges = pendingSessionAcr.changes;
                        approvedChanges.forEach((change) => {
                          const { name, args } = change;
                          try {
                            // Same executor as the review panel. These two used
                            // to be separate copies that disagreed.
                            applyProjectChange(name, args, activeProjectId);
                          } catch (err) {
                            console.error("Error executing action:", name, err);
                          }
                        });

                        setAcrStatus(pendingSessionAcr.id, "approved");
                        setActiveAcrId(null);

                        const systemMsg = {
                          role: "model",
                          parts: [
                            {
                              text: `✓ Approved: Applied all ${pendingSessionAcr.changes.length} proposed changes to your project.`,
                            },
                          ],
                          _timestamp: new Date().toISOString(),
                          _model: MODELS.REASONING,
                        } as any;
                        if (activeSessionId) {
                          updateSessionMessages(activeSessionId, [
                            ...messages,
                            systemMsg,
                          ]);
                        }
                      }}
                      className="flex-1 bg-qb-black text-white flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-orange transition-colors cursor-pointer border border-qb-black font-sans"
                    >
                      <Check className="w-3 h-3" /> APPROVE
                    </button>
                    <button
                      onClick={() => setActiveAcrId(pendingSessionAcr.id)}
                      className="flex-1 bg-transparent border border-qb-black text-qb-black flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-light-grey/30 transition-colors cursor-pointer font-sans"
                    >
                      REVIEW
                    </button>
                    <button
                      onClick={() => {
                        setAcrStatus(pendingSessionAcr.id, "rejected");
                        setActiveAcrId(null);
                        const systemMsg = {
                          role: "model",
                          parts: [
                            {
                              text: `✗ Rejected: Proposed modifications have been discarded.`,
                            },
                          ],
                          _timestamp: new Date().toISOString(),
                          _model: MODELS.REASONING,
                        } as any;
                        if (activeSessionId) {
                          updateSessionMessages(activeSessionId, [
                            ...messages,
                            systemMsg,
                          ]);
                        }
                      }}
                      className="flex-1 bg-transparent border border-qb-light-grey text-qb-magenta flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-magenta/5 transition-colors cursor-pointer font-sans"
                    >
                      <XIcon className="w-3 h-3" /> REJECT
                    </button>
                  </div>
                </div>
              );
            })()}
          {false && pendingBatch && (
            <div className="sidebar-content border-2 border-qb-orange p-4 bg-transparent shadow-sm flex flex-col gap-3 shrink-0">
              <div className="text-xs font-black uppercase tracking-widest text-qb-orange flex items-center gap-2">
                <span className="animate-pulse flex h-2 w-2 rounded-full bg-qb-orange"></span>
                {pendingBatch.calls.length} ACTION(S) REQUESTED
              </div>

              <div className="flex gap-2 mt-1">
                <button
                  onClick={() =>
                    executeBatch(
                      pendingBatch.calls,
                      "approved",
                      "User approved without changes.",
                    )
                  }
                  className="flex-1 bg-qb-black text-white flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-orange transition-colors"
                >
                  <Check className="w-3 h-3" /> APPROVE
                </button>
                <button
                  onClick={() => setIsReviewModalOpen(true)}
                  className="flex-1 bg-transparent border border-qb-black text-qb-black flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-light-grey/30 transition-colors"
                >
                  REVIEW
                </button>
                <button
                  onClick={() =>
                    executeBatch(
                      pendingBatch.calls,
                      "rejected",
                      "User rejected the actions.",
                    )
                  }
                  className="flex-1 bg-transparent border border-qb-light-grey text-qb-black flex items-center justify-center gap-2 text-xs font-bold tracking-widest py-2 hover:bg-qb-light-grey/30 transition-colors"
                >
                  <XIcon className="w-3 h-3" /> REJECT
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="text-xs font-mono font-black text-qb-grey flex items-center gap-2 tracking-widest uppercase">
              <span className="w-2 h-2 bg-qb-light-grey animate-bounce"></span>{" "}
              PROCESSING...
            </div>
          )}
          <div ref={messagesEndRef} className="h-1 shrink-0" />
        </div>

        {/* Input Area */}
        <div className="sidebar-content p-6 border-t border-qb-light-grey bg-qb-bg shrink-0">
          {/* Attachment Previews */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2 border-t border-l border-r border-qb-light-grey bg-qb-bg">
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 bg-qb-black text-white px-2 py-1 text-[11px] font-mono border border-qb-black select-none max-w-full"
                >
                  {getFileIcon(file.mimeType)}
                  <span className="truncate max-w-[100px]">{file.name}</span>
                  <span className="text-[9px] text-qb-grey">
                    ({formatFileSize(file.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedFiles((prev) =>
                        prev.filter((_, i) => i !== idx),
                      )
                    }
                    className="text-qb-grey hover:text-qb-orange ml-1 focus:outline-none"
                    title="Remove attachment"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Attached ACR Change Preview */}
          {attachedAcrChange && (
            <div className="mb-3 border border-qb-orange bg-qb-orange/5 p-3 flex items-start justify-between select-none">
              <div className="flex-1 min-w-0 pr-3">
                <span className="block text-[9px] font-black text-qb-orange uppercase tracking-widest mb-1">
                  ATTACHED PROPOSAL FOR DISCUSSION
                </span>
                <h4 className="text-[11px] font-bold text-qb-black uppercase tracking-wider truncate">
                  {attachedAcrChange.changeTitle}
                </h4>
                <span className="text-[9px] font-mono text-qb-grey block mt-0.5 tracking-wider uppercase">
                  ACTION: {attachedAcrChange.name.replace(/([A-Z])/g, " $1")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAttachedAcrChange(null)}
                className="text-qb-grey hover:text-qb-orange hover:bg-qb-light-grey/20 p-1 transition-colors cursor-pointer"
                title="Remove attached proposal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Thinking Budget Selector */}
          <div className="flex items-center justify-between mb-3 text-[10px] font-black tracking-widest text-qb-black uppercase select-none">
            <div className="flex items-center gap-1.5 text-qb-dark-grey">
              <span className="w-1.5 h-1.5 bg-qb-orange rounded-full animate-pulse"></span>
              <span>THINKING ENGINE</span>
            </div>
            <select
              value={thinkingLevel}
              onChange={(e) =>
                setThinkingLevel(e.target.value as ThinkingLevel)
              }
              className="bg-qb-bg border border-qb-light-grey text-[10px] font-black tracking-widest text-qb-black px-2.5 py-1 focus:border-qb-black focus:outline-none cursor-pointer uppercase transition-colors"
            >
              <option value={ThinkingLevel.LOW}>Housekeeping</option>
              <option value={ThinkingLevel.MEDIUM}>Competent</option>
              <option value={ThinkingLevel.HIGH}>Escalative</option>
            </select>
          </div>

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative border transition-all ${
              isDragging
                ? "border-qb-orange bg-qb-orange/5"
                : "border-qb-dark-grey focus-within:border-qb-black"
            }`}
          >
            {/* Prompt Template Picker Popover */}
            {isTemplatePickerOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-qb-bg border-2 border-qb-black shadow-2xl p-4 flex flex-col gap-3 z-30 animate-in fade-in duration-100 max-h-96">
                <div className="flex items-center justify-between border-b border-qb-light-grey pb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-qb-orange" />
                    <span className="text-xs font-black uppercase tracking-widest text-qb-black">
                      INSERT PROMPT TEMPLATE
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsTemplatePickerOpen(false);
                        onClose();
                        navigate('/settings?tab=templates');
                      }}
                      className="text-[9px] font-bold text-qb-grey hover:text-qb-orange uppercase flex items-center gap-1 cursor-pointer"
                    >
                      <SettingsIcon className="w-3 h-3" />
                      <span>MANAGE</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsTemplatePickerOpen(false)}
                      className="p-1 text-qb-grey hover:text-qb-black transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-qb-grey absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={templatePickerSearch}
                    onChange={(e) => setTemplatePickerSearch(e.target.value)}
                    placeholder="SEARCH TEMPLATES..."
                    className="w-full bg-white border border-qb-light-grey pl-8 pr-3 py-1.5 text-[11px] font-bold text-qb-black uppercase outline-none focus:border-qb-orange"
                  />
                </div>

                <div className="flex flex-col gap-2 overflow-y-auto max-h-56 no-scrollbar pr-0.5">
                  {promptTemplates
                    .filter((t) => {
                      if (!templatePickerSearch.trim()) return true;
                      const q = templatePickerSearch.toLowerCase();
                      return (
                        t.title.toLowerCase().includes(q) ||
                        t.description.toLowerCase().includes(q) ||
                        t.prompt.toLowerCase().includes(q)
                      );
                    })
                    .map((template) => {
                      const badgeColor = getCategoryBadgeColor(template.category);
                      return (
                        <div
                          key={template.id}
                          onClick={() => handleSelectTemplate(template)}
                          className="group border border-qb-light-grey bg-white p-2.5 flex flex-col gap-1 hover:border-qb-orange hover:bg-qb-orange/5 cursor-pointer transition-colors text-left"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-black text-qb-black uppercase group-hover:text-qb-orange">
                              {template.title}
                            </span>
                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 border ${badgeColor}`}>
                              {template.category}
                            </span>
                          </div>
                          {template.description && (
                            <p className="text-[10px] text-qb-grey line-clamp-1">
                              {template.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <textarea
              ref={inputRef}
              onChange={(e) => {
                const empty = e.target.value.trim() === "";
                if (empty !== isInputEmpty) setIsInputEmpty(empty);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={handlePaste}
              placeholder={
                isDragging
                  ? "Drop your files here!"
                  : "Ask for updates, attach files, or plan your project..."
              }
              className="w-full pl-4 pr-28 py-3 bg-transparent focus:outline-none resize-none text-sm font-medium tracking-wide placeholder-qb-grey transition-colors min-h-[72px]"
              rows={3}
              disabled={isLoading}
            ></textarea>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept="image/*,audio/*,video/*,.pdf,.txt,.csv,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.html,.css,.js,.json,.md"
            />

            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsTemplatePickerOpen(!isTemplatePickerOpen)}
                disabled={isLoading}
                className={`p-1.5 transition-colors cursor-pointer ${
                  isTemplatePickerOpen
                    ? "bg-qb-black text-white"
                    : "text-qb-dark-grey hover:text-qb-black hover:bg-qb-light-grey/20"
                }`}
                title="Choose from Prompt Templates"
              >
                <Sparkles className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="p-1.5 text-qb-dark-grey hover:text-qb-black hover:bg-qb-light-grey/20 transition-colors cursor-pointer"
                title="Attach files (PDFs, Images, Audio, Video, CSV, spreadsheets, and documents)"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="p-1.5 bg-qb-magenta text-white hover:bg-qb-orange transition-colors flex items-center justify-center cursor-pointer shadow-sm animate-pulse"
                  title="Stop generation"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={isInputEmpty && attachedFiles.length === 0}
                  className="p-1.5 bg-qb-black text-white hover:bg-qb-orange disabled:opacity-50 disabled:hover:bg-qb-black transition-colors"
                  title="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        <ConfirmationDialog
          isOpen={!!sessionToDelete}
          title="Delete Conversation"
          description="Are you sure you want to delete this conversation? This action cannot be undone."
          confirmText="CONFIRM DELETE"
          cancelText="CANCEL"
          onConfirm={() => {
            if (sessionToDelete) {
              deleteSession(sessionToDelete);
              setSessionToDelete(null);
            }
          }}
          onClose={() => setSessionToDelete(null)}
        />
      </div>

      {/* Right Side ACR Review Panel */}
      {activeAcr && (
        <div
          onMouseEnter={() => setIsMouseOverSidebar(true)}
          onMouseLeave={() => setIsMouseOverSidebar(false)}
          className={`${hideChatForReview ? "flex-1 w-full min-w-0 border-l-0" : "w-[360px] border-l border-qb-light-grey"} h-full flex flex-col bg-qb-bg relative select-none`}
        >
          {/* Header */}
          <div className="h-14 border-b border-qb-light-grey flex items-center justify-between px-6 bg-transparent shrink-0">
            <span className="text-xs font-black uppercase tracking-widest text-qb-orange">
              REVIEW PROPOSALS
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsChatHiddenDuringReview(!hideChatForReview)}
                className="p-1 text-qb-grey hover:text-qb-black transition-colors"
                title={hideChatForReview ? "Show the chat" : "Hide the chat and review on its own"}
              >
                {hideChatForReview ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => setActiveAcrId(null)}
                className="p-1 text-qb-grey hover:text-qb-black transition-colors"
                title="Close Review"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Prompt banner */}
          <div className="bg-qb-orange/5 border-b border-qb-light-grey p-4 text-[10px] uppercase font-black tracking-widest leading-relaxed text-qb-grey">
            REVIEW CRITICAL CHANGES PROPOSED BY ASSISTANT. UNCHECK ITEMS TO
            DECLINE THEM. CLICK TO FOCUS ON TARGET PAGE.
          </div>

          {/* Select All Toggle */}
          <div className="px-6 py-3 border-b border-qb-light-grey flex items-center justify-between bg-qb-bg shrink-0">
            <div className="flex items-center gap-3">
              <input
                id="acr-select-all"
                type="checkbox"
                checked={activeAcr.changes.every((c) => c.approved)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  activeAcr.changes.forEach((change) => {
                    updateAcrChangeApproval(activeAcr.id, change.id, checked);
                  });
                }}
                className="w-4 h-4 border border-qb-light-grey text-qb-orange accent-qb-orange focus:ring-0 focus:ring-offset-0 focus:outline-none rounded-none cursor-pointer"
              />
              <label
                htmlFor="acr-select-all"
                className="text-[10px] font-black uppercase tracking-widest text-qb-black cursor-pointer select-none"
              >
                SELECT ALL PROPOSALS
              </label>
            </div>
            <span className="text-[10px] font-mono font-bold text-qb-grey">
              {activeAcr.changes.filter((c) => c.approved).length} /{" "}
              {activeAcr.changes.length} SELECTED
            </span>
          </div>

          {/* List of changes */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {activeAcr.changes.map((change) => (
              <AcrChangeCard
                key={change.id}
                change={change}
                activeAcrChangeId={activeAcrChangeId}
                isMouseOverSidebar={isMouseOverSidebar}
                activeAcrId={activeAcr.id}
                updateAcrChangeApproval={updateAcrChangeApproval}
                getModulePathForTool={getModulePathForTool}
                handleFocusChange={handleFocusChange}
                setActiveAcrChangeId={setActiveAcrChangeId}
              />
            ))}
          </div>

          {/* Action Footer */}
          <div className="border-t border-qb-light-grey p-4 bg-transparent flex flex-col gap-2 shrink-0">
            <button
              onClick={handleApproveAcr}
              className="w-full bg-qb-black hover:bg-qb-orange text-white text-xs font-black uppercase tracking-widest py-3 transition-colors text-center cursor-pointer font-sans"
            >
              SIGN OFF
            </button>
            <button
              onClick={handleRejectAcr}
              className="w-full bg-transparent hover:bg-qb-magenta/5 text-qb-magenta text-xs font-black uppercase tracking-widest py-3 border border-qb-light-grey hover:border-qb-magenta transition-colors text-center cursor-pointer font-sans"
            >
              REJECT ALL
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface AcrChangeCardProps {
  change: any;
  activeAcrChangeId: string | null;
  isMouseOverSidebar: boolean;
  activeAcrId: string;
  updateAcrChangeApproval: (
    acrId: string,
    changeId: string,
    approved: boolean,
  ) => void;
  getModulePathForTool: (name: string) => string | null;
  handleFocusChange: (change: any) => void;
  setActiveAcrChangeId: (changeId: string | null) => void;
}

const AcrChangeCard: React.FC<AcrChangeCardProps> = ({
  change,
  activeAcrChangeId,
  isMouseOverSidebar,
  activeAcrId,
  updateAcrChangeApproval,
  getModulePathForTool,
  handleFocusChange,
  setActiveAcrChangeId,
}) => {
  const isFocused = activeAcrChangeId === change.id;
  const cardRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (isFocused && !isMouseOverSidebar && cardRef.current) {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        if (cardRef.current) {
          cardRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      }, 50);
    }
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [isFocused, isMouseOverSidebar]);

  const modulePath = getModulePathForTool(change.name);

  // The card used to be a title and nothing else. A person could not tell what
  // a proposal actually did without leaving the panel, opening the right
  // module, finding the record, and reading it. For an action no module draws
  // — a comment, a billing milestone — there was nowhere to go at all.
  //
  // Everything below is derived from the change itself, so no action can ever
  // be shown as a bare title again.
  const spec = getAcrActionSpec(change.name);
  const kindStyle = acrKindStyle(spec.kind);
  const targetRecord = findAcrTargetRecord(change);
  const targetName = describeAcrTargetRecord(targetRecord);

  // The card says WHAT kind of change this is, WHICH record it lands on, and
  // HOW MANY fields move. It does not list the fields: clicking the card opens
  // the record, and there each changed field shows its own old and new value.
  // Listing them here as well said everything twice.
  const diffs = diffsForChange(change, targetRecord);
  const isDelete = spec.kind === "delete";
  const isComment = spec.kind === "comment";
  // An edit to a comment already on the record carries its id. Find the old
  // text so the card can show it above the new.
  const editedCommentId = isComment ? (change.args as any)?.commentId : undefined;
  const oldCommentText = editedCommentId
    ? ((targetRecord as any)?.comments || []).find((c: any) => c.id === editedCommentId)?.text
    : undefined;

  const summaryLine = isDelete
    ? "This record will be removed"
    : isComment
      ? editedCommentId
        ? "An existing comment will be edited"
        : "A new comment will be added"
      : diffs.length === 0
        ? "No field values change"
        : `${diffs.length} field${diffs.length === 1 ? "" : "s"} change`;

  return (
    <div
      ref={cardRef}
      onClick={() => handleFocusChange(change)}
      onMouseEnter={() => setActiveAcrChangeId(change.id)}
      className={`border p-4 transition-all duration-200 cursor-pointer flex gap-3 ${
        isFocused
          ? "border-qb-orange bg-qb-orange/5 shadow-sm"
          : "border-qb-light-grey hover:border-qb-black bg-transparent"
      }`}
    >
      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
        <input
          type="checkbox"
          checked={change.approved}
          onChange={(e) =>
            updateAcrChangeApproval(activeAcrId, change.id, e.target.checked)
          }
          className="w-4 h-4 border border-qb-light-grey text-qb-orange accent-qb-orange focus:ring-0 focus:ring-offset-0 focus:outline-none rounded-none cursor-pointer"
        />
      </div>

      <div
        className={`flex-1 min-w-0 ${change.approved ? "" : "opacity-60"}`}
      >
        {/* What kind of change this is, in the same words every module uses. */}
        <div
          className={`text-[9px] font-black uppercase tracking-widest ${kindStyle.color} mb-1`}
        >
          {kindStyle.label}
        </div>

        <h4
          className={`text-xs font-black uppercase tracking-wider mb-1 leading-snug break-words ${change.approved ? "text-qb-black" : "text-qb-grey line-through"}`}
        >
          {change.changeTitle}
        </h4>

        {targetName && !isComment && (
          <div className="text-[9px] font-mono text-qb-dark-grey tracking-wider mb-1 truncate">
            ON: {targetName}
          </div>
        )}

        <div className="text-[9px] font-mono font-bold text-qb-grey tracking-widest uppercase">
          {change.name.replace(/([A-Z])/g, " $1")} · {summaryLine}
        </div>

        {/* The comment text is the whole of the change, so it is shown whole. */}
        {isComment && change.args?.text && (
          <div className="mt-2 border-l-2 border-qb-cyan pl-2.5 py-1 bg-qb-cyan/5">
            {editedCommentId && (
              <>
                <div className="text-[9px] font-black uppercase tracking-widest text-qb-dark-grey mb-0.5">
                  Now
                </div>
                <div className="text-[11px] font-mono text-qb-grey line-through leading-snug whitespace-pre-wrap break-words mb-1.5">
                  {oldCommentText !== undefined ? formatAcrValue(oldCommentText) : "That comment is no longer on this record."}
                </div>
              </>
            )}
            <div className="text-[9px] font-black uppercase tracking-widest text-qb-dark-grey mb-0.5">
              {editedCommentId ? "Becomes" : "Comment Text"}
            </div>
            <div className="text-[11px] font-mono text-qb-black leading-snug whitespace-pre-wrap break-words">
              {formatAcrValue(change.args.text)}
            </div>
          </div>
        )}

        {/* A removal has no new values. Show what is about to be lost. */}
        {isDelete && targetRecord && (
          <div className="mt-2 border-l-2 border-qb-magenta pl-2.5 py-1 bg-qb-magenta/5">
            <div className="text-[9px] font-black uppercase tracking-widest text-qb-magenta mb-0.5">
              Will Be Removed
            </div>
            <div className="text-[11px] font-mono text-qb-grey line-through leading-snug break-words">
              {targetName}
            </div>
          </div>
        )}

        {modulePath && (
          <span className="text-[9px] font-mono text-qb-cyan block mt-2 tracking-wider uppercase font-bold hover:underline">
            → GO TO PAGE
          </span>
        )}
      </div>
    </div>
  );
};

export default AISidebar;
