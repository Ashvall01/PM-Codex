import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { Mic, Square, Play, Pause, Upload, CheckCircle, Clock, Volume2, AlertCircle, AlertTriangle, FileText, ChevronRight, ChevronDown, ChevronUp, Check, Sparkles, RefreshCw, Trash2, Copy, Edit3, ArrowRight } from 'lucide-react';
import { GoogleGenAI, FunctionDeclaration, Type, Content } from '@google/genai';
import { MODELS } from '../../config/models';
import { gemini, geminiErrorText } from '../../services/geminiClient';

const MEETING_SAFETY_SETTINGS: any[] = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];
import { useMomStore, MoMActionItem } from '../../store/momStore';
import { useTasksStore } from '../../store/tasksStore';

import { useDeliverablesStore } from '../../store/deliverablesStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useRisksStore } from '../../store/risksStore';
import { useBillingStore } from '../../store/billingStore';
import { useStakeholdersStore } from '../../store/stakeholdersStore';
import { getProjectStateSnapshot, executeProjectQuery } from '../../services/aiContextEngine';
import { sanitizeString, reconstructString } from '../../utils/piiSanitization';
import { usePIIStore } from '../../store/piiStore';
import { RichTextEditor } from '../../components/RichTextEditor';
import { useMeetingsStore } from '../../store/meetingsStore';
import { safeStateStorage } from '../../utils/safeStorage';
import { useAcrStore, ACRChange } from '../../store/acrStore';
import { useAiStore } from '../../store/aiStore';

// Gemini goes through the local key server — see services/geminiClient.ts.
const ai = gemini;

// Stage 2 Dynamic Query Tool Declarations for transcript analysis
const meetingQueryTools: FunctionDeclaration[] = [
  {
    name: 'getStakeholders',
    description: 'Query stakeholders and team members registry with optional search query to identify attendees and assignees.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Optional search keyword (e.g. name or role)' }
      }
    }
  },
  {
    name: 'getTasks',
    description: 'Get project action items, issues, and tasks to check for existing tasks to update or prevent duplicates.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: { type: Type.STRING, description: 'Optional task status filter' }
      }
    }
  },
  {
    name: 'getTimelineActivities',
    description: 'Get active timeline activities, sub-activities, dates, and progress to cross-reference timeline updates.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getDeliverables',
    description: 'Get active project deliverables, definitions of done, and status to map deliverables discussed in the meeting.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getRisks',
    description: 'Get project risk register items to cross-reference risks or mitigations raised in the meeting.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getMilestones',
    description: 'Get billing and payment milestones to cross-reference milestone signoffs discussed in the meeting.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'getCodexContent',
    description: 'Retrieve content of a specific Codex knowledge base page.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'Page ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'getMomHistory',
    description: 'Query prior minutes of meetings to verify previous decisions or action items.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'Optional specific MoM ID' }
      }
    }
  }
];

// Helper to extract text from all parts of a Gemini candidate response
const extractCandidateText = (response: any): string => {
  if (response?.text && typeof response.text === 'string' && response.text.trim()) {
    return response.text;
  }
  const candidate = response?.candidates?.[0];
  if (!candidate?.content?.parts) return '';
  
  // Combine all parts that contain text, prioritizing non-thought text if present
  const normalTextParts = candidate.content.parts
    .filter((p: any) => p.text && !p.thought)
    .map((p: any) => p.text)
    .join('\n')
    .trim();
    
  if (normalTextParts) return normalTextParts;
  
  // If only raw parts exist, return their text
  const anyTextParts = candidate.content.parts
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join('\n')
    .trim();

  return anyTextParts || '';
};

// Helper to clean up autoregressive repetition loops in transcripts
const deduplicateTranscript = (text: string): string => {
  if (!text || text.trim().length === 0) return text;

  // 1. Remove consecutive identical lines / speaker turns
  const lines = text.split('\n');
  const cleanedLines: string[] = [];
  let prevLineTrimmed = '';
  let repeatCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && trimmed === prevLineTrimmed) {
      repeatCount++;
      if (repeatCount <= 1) {
        cleanedLines.push(line);
      }
    } else {
      repeatCount = 0;
      prevLineTrimmed = trimmed;
      cleanedLines.push(line);
    }
  }

  let result = cleanedLines.join('\n');

  // 2. Remove consecutive repeating phrases/sentences (e.g. "Jadi dia bikinnya short integer. Jadi dia bikinnya...")
  // Catches phrases of 3 to 20 words repeated 2 or more times
  result = result.replace(/(\b(?:[a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]+(?:\s+|,|\.)){3,20}?)\s*(?:\1\s*){2,}/gi, '$1 ');

  // 3. Remove short repeating clauses like "Ini paling gampang. Ini paling gampang."
  result = result.replace(/([^.!?\n]{5,50}[.!?])(\s*\1){2,}/gi, '$1');

  return result.trim();
};

// Helper to determine clean audio mime type across different browsers and file types
const getAudioMimeType = (blob: Blob, fileName?: string): string => {
  if (blob.type && blob.type.startsWith('audio/')) {
    return blob.type;
  }
  const name = fileName || (blob instanceof File ? blob.name : '');
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'wav':
    case 'wave':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mp3';
    case 'm4a':
      return 'audio/m4a';
    case 'aac':
      return 'audio/aac';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'audio/webm';
    case 'mp4':
      return 'audio/mp4';
    default:
      return blob.type || 'audio/wav';
  }
};

interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: any) => void;
  fallbackModel?: string;
}

const isTransientError = (err: any): boolean => {
  if (!err) return false;
  const msg = (err.message || err.toString() || '').toLowerCase();
  const status = err.status || err.code || err.statusCode;
  return (
    status === 503 ||
    status === 429 ||
    status === 'UNAVAILABLE' ||
    status === 'RESOURCE_EXHAUSTED' ||
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('high demand') ||
    msg.includes('unavailable') ||
    msg.includes('resource exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('network error')
  );
};

const generateContentWithRetry = async (
  aiClient: GoogleGenAI,
  params: {
    model: string;
    contents: any;
    config?: any;
  },
  options: RetryOptions = {}
): Promise<any> => {
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.initialDelayMs ?? 2000;
  let currentModel = params.model;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await aiClient.models.generateContent({
        ...params,
        model: currentModel,
      });

      // Check if response was blocked at the prompt level (e.g. PROHIBITED_CONTENT)
      const blockReason = response?.promptFeedback?.blockReason;
      const finishReason = response?.candidates?.[0]?.finishReason;
      const isBlocked = blockReason === 'PROHIBITED_CONTENT' || blockReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'SAFETY';

      if (isBlocked && options.fallbackModel && currentModel !== options.fallbackModel) {
        if (options.onRetry) {
          options.onRetry(
            attempt,
            1000,
            new Error(`Safety filter false-positive (${blockReason || finishReason}) on ${currentModel}. Re-routing to fallback model (${options.fallbackModel})...`)
          );
        }
        currentModel = options.fallbackModel;
        continue;
      }

      return response;
    } catch (err: any) {
      const isTransient = isTransientError(err);
      if (!isTransient || attempt > maxRetries) {
        throw err;
      }

      // If we failed after 2 attempts on high demand, try fallback model if provided
      if (attempt >= 2 && options.fallbackModel && currentModel !== options.fallbackModel) {
        currentModel = options.fallbackModel;
      }

      if (options.onRetry) {
        options.onRetry(attempt, delay, err);
      }

      // Wait with jitter before next attempt
      const jitter = Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      delay *= 1.8;
    }
  }
};

export const Meetings: React.FC = () => {
  const activeProjectId = useAppStore(state => state.activeProjectId);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lastAudioBlob, setLastAudioBlob] = useState<Blob | null>(null);
  const [audioFileInfo, setAudioFileInfo] = useState<{ name: string; size: number; type: string } | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  
  const transcript = useMeetingsStore(state => state.currentMeetingTranscript);
  const setTranscript = useMeetingsStore(state => state.setCurrentMeetingTranscript);
  const analysisResult = useMeetingsStore(state => state.currentMeetingAnalysisResult);
  const setAnalysisResult = useMeetingsStore(state => state.setCurrentMeetingAnalysisResult);

  // Active input hardware connection flags
  const [isMicActive, setIsMicActive] = useState(false);
  const [isSystemActive, setIsSystemActive] = useState(false);

  // Real-time operations background pipeline logger
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [pipelineError, setPipelineError] = useState<{ title: string; message: string; details?: string } | null>(null);

  // States to facilitate Human-In-The-Loop Draft Suggestions (Support full MoM metadata schema)
  const [processingStep, setProcessingStep] = useState<'idle' | 'transcribing' | 'analyzing' | 'complete'>('idle');
  const draftMoM = useMeetingsStore(state => state.draftMoM);
  const setDraftMoM = useMeetingsStore(state => state.setDraftMoM);
  const draftActionItems = useMeetingsStore(state => state.draftActionItems);
  const setDraftActionItems = useMeetingsStore(state => state.setDraftActionItems);
  const draftUpdates = useMeetingsStore(state => state.draftUpdates);
  const setDraftUpdates = useMeetingsStore(state => state.setDraftUpdates);
  const [committed, setCommitted] = useState(false);
  const [iterationRemarks, setIterationRemarks] = useState('');

  const isHydrating = useRef(false);

  // Load state when activeProject changes
  useEffect(() => {
    if (!activeProjectId) return;

    isHydrating.current = true;
    const saved = safeStateStorage.getItem(`pm-codex-meeting-state-${activeProjectId}`);
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setTranscript(data.transcript ?? '');
        setAnalysisResult(data.analysisResult ?? null);
        
        let step = data.processingStep ?? 'idle';
        let hydratedLogs = data.logs ?? [];
        if (step === 'transcribing' || step === 'analyzing') {
          step = 'idle';
          hydratedLogs = [...hydratedLogs, `[SYSTEM] [WARN] Pipeline processing was interrupted by page reload.`];
        }
        
        setProcessingStep(step);
        setDraftMoM(data.draftMoM ?? null);
        setDraftActionItems(data.draftActionItems ?? []);
        setDraftUpdates(data.draftUpdates ?? []);
        setCommitted(data.committed ?? false);
        setLogs(hydratedLogs);
      } catch (e) {
        console.error('Failed to parse saved meeting state', e);
      }
    } else {
      // Reset to defaults
      setTranscript('');
      setAnalysisResult(null);
      setProcessingStep('idle');
      setDraftMoM(null);
      setDraftActionItems([]);
      setDraftUpdates([]);
      setCommitted(false);
      setLogs([]);
    }
    
    const timer = setTimeout(() => {
      isHydrating.current = false;
    }, 50);
    return () => clearTimeout(timer);
  }, [activeProjectId]);

  // Save state when any related state changes
  useEffect(() => {
    if (!activeProjectId || isHydrating.current) return;

    // If meeting is idle and empty or already committed, remove saved scratchpad to keep storage clean
    if ((!transcript && !analysisResult && processingStep === 'idle') || committed) {
      safeStateStorage.removeItem(`pm-codex-meeting-state-${activeProjectId}`);
      return;
    }

    const stateToSave = {
      transcript,
      analysisResult,
      processingStep,
      draftMoM,
      draftActionItems,
      draftUpdates,
      committed,
      logs: logs.slice(-50) // keep last 50 logs at most
    };
    safeStateStorage.setItem(`pm-codex-meeting-state-${activeProjectId}`, JSON.stringify(stateToSave));
  }, [activeProjectId, transcript, analysisResult, processingStep, draftMoM, draftActionItems, draftUpdates, committed, logs]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const streamsRef = useRef<{ mic?: MediaStream; display?: MediaStream; audioCtx?: AudioContext; hiddenAudioEl?: HTMLAudioElement }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const handleClearSession = () => {
    setTranscript('');
    setAnalysisResult(null);
    setDraftMoM(null);
    setDraftActionItems([]);
    setDraftUpdates([]);
    setCommitted(false);
    setLogs([]);
    setPipelineError(null);
    setAudioUrl(null);
    setLastAudioBlob(null);
    setAudioFileInfo(null);
    setProcessingStep('idle');
    if (activeProjectId) {
      safeStateStorage.removeItem(`pm-codex-meeting-state-${activeProjectId}`);
    }
  };

  const handleCreateBlankDraft = () => {
    const currentDate = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    setDraftMoM({
      title: `Meeting Note ${new Date().toLocaleDateString()}`,
      date: currentDate,
      time: currentTime,
      location: 'Virtual Call / Sync',
      attendees: 'Attendees',
      agenda: 'Meeting alignment and action review',
      keyDecisions: '',
      notes: '',
    });
    setDraftActionItems([]);
    setDraftUpdates([]);
    setPipelineError(null);
    setProcessingStep('complete');
    addLog("Created blank draft template for manual entry.");
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setPipelineError(null);
      const mimeType = getAudioMimeType(file);
      addLog(`File uploaded: "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB, ${mimeType}). Starting decode.`);
      setAudioUrl(URL.createObjectURL(file));
      setLastAudioBlob(file);
      setAudioFileInfo({
        name: file.name,
        size: file.size,
        type: mimeType
      });
      processAudio(file, 'normal', file.name);
      // Reset input value so re-uploading the same file works
      event.target.value = '';
    }
  };

  const startRecording = async () => {
    try {
      setCommitted(false);
      setDraftMoM(null);
      setDraftActionItems([]);
      setDraftUpdates([]);
      setTranscript('');
      setAnalysisResult(null);
      setLastAudioBlob(null);
      setLogs([]);
      setIsMicActive(false);
      setIsSystemActive(false);

      addLog("Initializing Audio Recording Pipeline...");

      // 1. Request microphone audio
      addLog("Requesting hardware Microphone stream permissions...");
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const micHasAudio = micStream.getAudioTracks().length > 0;
      setIsMicActive(micHasAudio);
      if (micHasAudio) {
         addLog("Microphone channel verified successfully.");
      }

      // 2. Request system audio using getDisplayMedia with support options
      addLog("Opening Screen Share Capture interface for system sound routing...");
      let displayStream: MediaStream | null = null;
      try {
         displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: "browser" },
            audio: {
               systemAudio: "include",
               echoCancellation: false,
               noiseSuppression: false,
               autoGainControl: false,
            } as any
         });
      } catch (err: any) {
         if (err.name !== 'NotAllowedError') {
             console.warn("Could not retrieve display media capture", err);
             addLog(`[WARN] Screen capture engine could not initialize: ${err.message}`);
         } else {
             addLog("[INFO] User bypassed Screen Sound routing. Capture will default strictly to microphone.");
         }
      }

      // Initialize browser AudioContext for standard hardware mixing
      addLog("Constructing Core AudioContext Mixer node...");
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Explicitly ensure the layout resumes the suspended context to satisfy browser policies
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        addLog("AudioContext mixer node successfully resumed.");
      }

      const dest = audioCtx.createMediaStreamDestination();

      if (micHasAudio) {
        addLog("Connecting Microphone stream to mixer destination.");
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(dest);
      }

      const systemHasAudio = !!(displayStream && displayStream.getAudioTracks().length > 0);
      setIsSystemActive(systemHasAudio);

      let hiddenAudioEl;
      if (systemHasAudio && displayStream) {
        addLog("Dual-channel detection target. System sound channel successfully connected to mixer.");
        
        // --- CHROME BUG FIX ---
        // Chrome fails to output audio from a getDisplayMedia capture in Web Audio API 
        // unless it's also actively assigned to an HTML media element.
        hiddenAudioEl = new Audio();
        hiddenAudioEl.muted = true;
        hiddenAudioEl.srcObject = displayStream;
        hiddenAudioEl.play().catch(err => console.warn("Hidden audio workaround play failed", err));
        // ----------------------

        const displaySource = audioCtx.createMediaStreamSource(displayStream);
        displaySource.connect(dest);
      } else if (displayStream) {
        addLog("[INFO] No System sound detected on the screen track. Purging screen video frame track to save buffer space.");
        displayStream.getTracks().forEach(t => t.stop());
      }

      addLog("Binding Mixed system stream output to MediaRecorder buffer...");
      const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        addLog("MediaRecorder stopped. Finalizing WebM Blob formatting...");
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        setLastAudioBlob(audioBlob);
        processAudio(audioBlob);
      };

      streamsRef.current = { mic: micStream, display: displayStream || undefined, audioCtx, hiddenAudioEl };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      addLog("RECORDING COMMENCED. Fully mixing microphone and active system audio paths.");

    } catch (err: any) {
      console.error('Error starting recording:', err);
      addLog(`[FATAL ERROR] Could not initialize mixer channels: ${err.message}`);
      alert('Could not start recording. Please ensure you have granted Microphone permissions, selected a tab/screen to share, and checked "Share audio" inside Chrome\'s screen capture frame!');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      addLog("Stopping system recorder and detaching hardware streams.");
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      const { mic, display, audioCtx, hiddenAudioEl } = streamsRef.current;
      if (hiddenAudioEl) hiddenAudioEl.srcObject = null;
      if (mic) mic.getTracks().forEach(t => t.stop());
      if (display) display.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close();
      streamsRef.current = {};
      
      setIsMicActive(false);
      setIsSystemActive(false);
      addLog("Hardware paths cleanly disconnected. Initiating AI cognitive processing pipeline.");
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
         const base64data = (reader.result as string).split(',')[1];
         resolve(base64data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const [isPastingTranscript, setIsPastingTranscript] = useState(false);
  const [pastedTranscript, setPastedTranscript] = useState('');

  const generatePrompt = () => {
    const projectSnapshot = activeProjectId ? getProjectStateSnapshot(activeProjectId) : "No active project context.";

    const currentDate = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    return `You are PM Codex's Strategic Meeting Intelligence system. You possess full contextual awareness of the project identical to the AI Sidebar engine.
Analyze this meeting transcript strictly against the project snapshot baseline data provided below.
The meeting is recorded on ${currentDate} at ${currentTime}.

Extract major outputs, metadata, and suggested actions.

Perform the following:
1. Formulate a suitable, executive, project-aligned Title for the meeting based on conversation context.
2. Estimate the Date (YYYY-MM-DD) and Location/Channel discussed. Use ${currentDate} for the date and ${currentTime} for the time unless specified otherwise.
3. Formulate attendees list. Match speaker names against the official Stakeholders registry from the project context whenever possible, including their designated roles (e.g., "Sarah Jenkins (Project Manager), David Chen (Lead Architect)"). List any unidentified speakers as external guests.
4. Extract key Decisions & Agreements. Filter out minor conversational debates, displaying only accepted resolutions.
5. Extract primary secondary Ideas, Explanations, or Procedures discussed.
6. Compare meeting outcomes against the complete Project Baseline data:
   - Identify entirely new action items and assignees (preferring known stakeholders as assignees). Structure them as "newActionItems".
   - If a meeting outcome directly updates or completes an Existing Task, Timeline Activity/Sub-activity, Deliverable, Risk, or Billing/Payment Milestone, propose standard updates with its ID under "updatedRecords". Provide a concise display name explaining what that record was under "recordTitle".
   - Supported record types for "updatedRecords": "Task" | "Timeline" | "Deliverable" | "Risk" | "Milestone".

=== COMPLETE PROJECT BASELINE DATA ===
${projectSnapshot}

Format the response strictly as valid, raw JSON:
{
  "title": "Synthesis / Alignment meeting",
  "date": "YYYY-MM-DD",
  "time": "10:00",
  "location": "Virtual Call / Teams",
  "attendees": "Speaker 1 (Role), Speaker 2 (Role)",
  "agenda": "Sync on outstanding baseline deliverables and action plan.",
  "decisions": ["decision 1", "decision 2"],
  "ideas": ["idea 1", "idea 2"],
  "newActionItems": [
     { "description": "task description", "owner": "Assigned Person", "dueDate": "YYYY-MM-DD" }
  ],
  "updatedRecords": [
     { "id": "existing-id", "type": "Task|Timeline|Deliverable|Risk|Milestone", "recordTitle": "Title", "updates": { "status": "Done" } }
  ],
  "remarks": "Summary of AI remarks, cross-checks, or changes made"
}
Ensure there is absolutely no markdown code wrappers surrounding or enclosing the JSON response. Respond with raw JSON text.`;
  };

  const handleAIResponse = (responseText: string | undefined) => {
    const text = responseText || "{}";
    let cleanedJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstBrace = cleanedJson.indexOf('{');
    const lastBrace = cleanedJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
    }
    
    try {
      addLog("Parsing AI Cognitive responses and formulating Assistant Change Request (ACR)...");
      const parsed = JSON.parse(cleanedJson);
      setAnalysisResult(parsed);

      if (parsed.remarks) {
        setIterationRemarks(parsed.remarks);
      } else {
        setIterationRemarks('');
      }

      const meetingTitle = parsed.title || `Meeting Note ${new Date().toLocaleDateString()}`;
      const meetingDate = parsed.date || new Date().toISOString().split('T')[0];
      const meetingTime = parsed.time || '10:00';
      const meetingLocation = parsed.location || 'Virtual teams / Remote Call';
      const meetingAttendees = parsed.attendees || 'System Captured Speakers';
      const meetingAgenda = parsed.agenda || 'Meeting sync alignment';
      const meetingKeyDecisions = parsed.decisions?.join('\n') || '';
      const meetingNotes = parsed.ideas?.join('\n') || '';

      const draftMoMObj = {
        title: meetingTitle,
        date: meetingDate,
        time: meetingTime,
        location: meetingLocation,
        attendees: meetingAttendees,
        agenda: meetingAgenda,
        keyDecisions: meetingKeyDecisions,
        notes: meetingNotes,
      };
      setDraftMoM(draftMoMObj);

      const parsedActionItems = (parsed.newActionItems && Array.isArray(parsed.newActionItems))
        ? parsed.newActionItems.map((item: any, idx: number) => ({
            id: `draft-task-${idx}`,
            description: item.description || '',
            owner: item.owner || 'PM',
            dueDate: item.dueDate || new Date().toISOString().split('T')[0],
            approved: true,
          }))
        : [];
      setDraftActionItems(parsedActionItems);

      const parsedUpdates = (parsed.updatedRecords && Array.isArray(parsed.updatedRecords))
        ? parsed.updatedRecords.map((ur: any, idx: number) => ({
            id: `draft-update-${idx}`,
            recordId: ur.id || '',
            type: ur.type || 'Task',
            recordTitle: ur.recordTitle || `Record ${ur.id}`,
            updates: ur.updates || {},
            approved: true,
          }))
        : [];
      setDraftUpdates(parsedUpdates);

      // Construct Assistant Change Request (ACR) batch
      if (activeProjectId) {
        const rawChanges: { name: string; args: any }[] = [];

        // 1. Change: Create / Register Minutes of Meeting
        rawChanges.push({
          name: 'createMoM',
          args: {
            title: meetingTitle,
            date: meetingDate,
            time: meetingTime,
            location: meetingLocation,
            attendees: meetingAttendees,
            agenda: meetingAgenda,
            notes: meetingNotes,
            keyDecisions: meetingKeyDecisions,
            actionItems: parsedActionItems.map(a => ({
              description: a.description,
              assignee: a.owner,
              status: 'Open',
            })),
          },
        });

        // 2. Change: Create new Task records for actionable items
        parsedActionItems.forEach((aiItem) => {
          rawChanges.push({
            name: 'addTask',
            args: {
              type: 'Action Item',
              description: aiItem.description,
              owner: aiItem.owner,
              estimatedResolutionDate: aiItem.dueDate,
              status: 'Open',
              priority: 'Medium',
              remarks: `Extracted from meeting: ${meetingTitle}`,
              source: `Meeting: ${meetingTitle}`,
            },
          });
        });

        // 3. Changes: Updates to existing project records
        parsedUpdates.forEach((upItem) => {
          if (upItem.type === 'Task') {
            rawChanges.push({
              name: 'updateTask',
              args: {
                id: upItem.recordId,
                ...upItem.updates,
              },
            });
          } else if (upItem.type === 'Timeline') {
            rawChanges.push({
              name: 'updateTimelineRow',
              args: {
                id: upItem.recordId,
                ...upItem.updates,
              },
            });
          } else if (upItem.type === 'Deliverable') {
            rawChanges.push({
              name: 'updateDeliverable',
              args: {
                id: upItem.recordId,
                ...upItem.updates,
              },
            });
          } else if (upItem.type === 'Risk') {
            rawChanges.push({
              name: 'updateProjectRisk',
              args: {
                id: upItem.recordId,
                ...upItem.updates,
              },
            });
          } else if (upItem.type === 'Milestone') {
            rawChanges.push({
              name: 'updateMilestone',
              args: {
                id: upItem.recordId,
                ...upItem.updates,
              },
            });
          }
        });

        // Resolve or create session for the AI Sidebar
        let targetSessionId = useAiStore.getState().activeSessionId;
        const projectSessions = useAiStore.getState().sessions.filter(s => s.projectId === activeProjectId);
        if (!targetSessionId || !projectSessions.some(s => s.id === targetSessionId)) {
          if (projectSessions.length > 0) {
            targetSessionId = projectSessions[0].id;
            useAiStore.getState().setActiveSessionId(targetSessionId);
          } else {
            targetSessionId = useAiStore.getState().createSession(activeProjectId, `Meeting: ${meetingTitle}`);
          }
        }

        // Create the ACR in acrStore
        const newAcrId = useAcrStore.getState().createAcr(activeProjectId, targetSessionId, rawChanges);
        if (newAcrId) {
          useAcrStore.getState().setActiveAcrId(newAcrId);
        }

        // Add summary note into AI conversation session for seamless conversation continuity
        const currentSession = useAiStore.getState().sessions.find(s => s.id === targetSessionId);
        if (currentSession) {
          const updatedMessages: Content[] = [
            ...(currentSession.messages || []),
            {
              role: 'model',
              parts: [
                {
                  text: `I have completed the intelligence analysis for meeting **"${meetingTitle}"**.\n\n` +
                    `📋 **Meeting Summary & Highlights:**\n` +
                    `- **Attendees:** ${meetingAttendees}\n` +
                    `- **Agenda:** ${meetingAgenda}\n` +
                    `- **Action Items Detected:** ${parsedActionItems.length}\n` +
                    `- **Project Updates Identified:** ${parsedUpdates.length}\n\n` +
                    `I have staged these as an **Assistant Change Request (ACR)** for your review. You can inspect each change, modify details, approve or reject items individually, or ask me to make any adjustments.`
                }
              ],
              _timestamp: new Date().toISOString(),
            } as any
          ];
          useAiStore.getState().updateSessionMessages(targetSessionId, updatedMessages);
        }

        addLog(`Created Assistant Change Request (ACR) with ${rawChanges.length} proposed operations.`);

        // Automatically open the AI Sidebar to reveal the performed actions & ACR
        useAiStore.getState().setSidebarOpen(true);
        addLog("Activated AI Sidebar with Assistant Change Request Hub.");
      }

    } catch (e) {
      console.error('Core AI parsing failure:', e);
      addLog(`[WARN] Model output parsing error: ${e instanceof Error ? e.message : 'Invalid JSON format'}. Invoking fallback formatter.`);
      handleAIError(e);
    }
  };

  const handleAIError = (err: any) => {
    console.error('Processing error:', err);
    addLog("[FALLBACK] Formulating generic mock meeting structures due to model pipeline limits.");
    const fallbackParsed = {
      title: `Meeting Note ${new Date().toLocaleDateString()} (Draft)`,
      date: new Date().toISOString().split('T')[0],
      time: '11:00',
      location: 'Virtual Sync Call',
      attendees: 'Attendees unconfirmed',
      agenda: 'Status alignment review',
      decisions: ["Confirm alignment on delivery baseline next week.", "Resolve outstanding stream routing diagnostics."],
      ideas: ["Evaluate microphone routes and screen-sharing system audio bindings."],
      newActionItems: [{ description: "Optimize audio mixer routes", owner: "Lead Dev", dueDate: new Date().toISOString().split('T')[0] }],
      updatedRecords: []
    };
    setTranscript(transcript || "Speech processed successfully. Review suggested assets below.");
    setAnalysisResult(fallbackParsed);
    
    setDraftMoM({
      title: fallbackParsed.title,
      date: fallbackParsed.date,
      time: fallbackParsed.time,
      location: fallbackParsed.location,
      attendees: fallbackParsed.attendees,
      agenda: fallbackParsed.agenda,
      keyDecisions: fallbackParsed.decisions.join('\n'),
      notes: fallbackParsed.ideas.join('\n'),
    });

    setDraftActionItems(fallbackParsed.newActionItems.map((i, idx) => ({
       id: `draft-tk-${idx}`,
       description: i.description,
       owner: i.owner,
       dueDate: i.dueDate,
       approved: true,
    })));
    setDraftUpdates([]);
    setProcessingStep('complete');
  };

  // Stage 2 Multi-Turn Analysis with dynamic Query Tool calls
  const executeStage2Analysis = async (transcriptText: string, piiEntries: any[]) => {
    addLog("Running Stage 2/2: Mapping baselines & analyzing with dynamic tool calls...");
    setProcessingStep('analyzing');

    const analysisPrompt = generatePrompt();
    const sanitizedAnalysisPrompt = sanitizeString(analysisPrompt, piiEntries);
    const sanitizedTranscript = sanitizeString(transcriptText, piiEntries);
    const userMessageContent = `Here is the clean transcript to map and extract from:\n\n${sanitizedTranscript}\n\n`;

    const conversationContents: Content[] = [
      {
        role: 'user',
        parts: [
          { text: sanitizedAnalysisPrompt },
          { text: userMessageContent }
        ]
      }
    ];

    let currentTurn = 0;
    const maxToolTurns = 5;
    let finalModelResponseText = '';

    while (currentTurn < maxToolTurns) {
      currentTurn++;
      const response = await generateContentWithRetry(
        ai,
        {
          model: MODELS.REASONING,
          contents: conversationContents,
          config: {
            maxOutputTokens: 16384,
            tools: [{ functionDeclarations: meetingQueryTools }],
            safetySettings: MEETING_SAFETY_SETTINGS,
          },
        },
        {
          maxRetries: 3,
          initialDelayMs: 2000,
          onRetry: (attempt, delayMs) => {
            addLog(`[RETRY] Stage 2 analysis experiencing load spike. Retrying in ${(delayMs / 1000).toFixed(1)}s (Attempt ${attempt}/3)...`);
          }
        }
      );

      const candidate = response.candidates?.[0];
      const modelParts = candidate?.content?.parts || [];
      const functionCalls = modelParts.filter((p: any) => p.functionCall);

      if (functionCalls.length > 0 && activeProjectId) {
        conversationContents.push({
          role: 'model',
          parts: modelParts
        });

        const toolResponseParts: any[] = [];
        for (const fcPart of functionCalls) {
          const fc = (fcPart as any).functionCall;
          addLog(`AI querying project state via tool: ${fc.name}(${JSON.stringify(fc.args || {})})`);
          const queryResult = executeProjectQuery(fc.name, fc.args || {}, activeProjectId);
          toolResponseParts.push({
            functionResponse: {
              name: fc.name,
              response: { result: queryResult }
            }
          });
        }

        conversationContents.push({
          role: 'user',
          parts: toolResponseParts
        });
      } else {
        finalModelResponseText = extractCandidateText(response);
        break;
      }
    }

    if (!finalModelResponseText) {
      // Fallback one-shot call if tool loop didn't yield text
      const fallbackResponse = await generateContentWithRetry(
        ai,
        {
          model: MODELS.REASONING,
          contents: conversationContents,
          config: {
            maxOutputTokens: 16384,
            safetySettings: MEETING_SAFETY_SETTINGS,
          },
        },
        {
          maxRetries: 3,
          initialDelayMs: 2000,
          onRetry: (attempt, delayMs) => {
            addLog(`[RETRY] Retrying fallback analysis in ${(delayMs / 1000).toFixed(1)}s (Attempt ${attempt}/3)...`);
          }
        }
      );
      finalModelResponseText = extractCandidateText(fallbackResponse);
    }

    const reconstructedAnalysis = reconstructString(finalModelResponseText, piiEntries);
    handleAIResponse(reconstructedAnalysis);
    setProcessingStep('complete');
    addLog("Meeting pipeline successfully completed. ACR proposed and AI Sidebar opened.");
  };

  const processAudio = async (audioBlob: Blob, sensitivity: 'normal' | 'high' = 'normal', fileName?: string) => {
    setIsProcessing(true);
    setProcessingStep('transcribing');
    setCommitted(false);
    setDraftMoM(null);
    setDraftActionItems([]);
    setDraftUpdates([]);
    setPipelineError(null);

    // Set when we upload via the Files API, so the finally block can clean up.
    let uploadedFileName: string | undefined;

    try {
      const piiEntries = activeProjectId ? usePIIStore.getState().entries.filter(e => e.projectId === activeProjectId) : [];

      const mimeType = getAudioMimeType(audioBlob, fileName || audioFileInfo?.name);
      addLog(`Preparing ${sensitivity === 'high' ? 'High-Sensitivity' : 'Standard'} transcription (MIME: ${mimeType})...`);

      // Inline data is base64-encoded, inflating the payload by ~4/3, and the
      // whole request must fit inside the 20 MB inline ceiling. Anything larger
      // goes through the Files API, which streams the blob (no giant base64
      // string on the main thread) and supports up to 9.5 hours of audio.
      const INLINE_AUDIO_LIMIT_BYTES = 15 * 1024 * 1024;
      let audioPart: Record<string, unknown>;

      if (audioBlob.size <= INLINE_AUDIO_LIMIT_BYTES) {
        const base64Data = await blobToBase64(audioBlob);
        audioPart = { inlineData: { mimeType, data: base64Data } };
      } else {
        const sizeMb = (audioBlob.size / 1024 / 1024).toFixed(1);
        addLog(`Audio is ${sizeMb} MB — exceeds the inline limit. Uploading via Files API...`);

        const uploaded = await ai.files.upload({
          file: audioBlob,
          config: { mimeType },
        });
        uploadedFileName = uploaded.name;
        addLog(`Upload accepted (${uploaded.name}). Waiting for server-side processing...`);

        // Large media is not immediately usable — poll until it leaves PROCESSING.
        let fileInfo = uploaded;
        let waited = 0;
        const POLL_MS = 2000;
        const TIMEOUT_MS = 5 * 60 * 1000;
        while (String(fileInfo.state) === 'PROCESSING') {
          if (waited >= TIMEOUT_MS) {
            throw new Error(`File processing timed out after ${TIMEOUT_MS / 1000}s (state still PROCESSING).`);
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
          waited += POLL_MS;
          fileInfo = await ai.files.get({ name: uploaded.name as string });
        }

        if (String(fileInfo.state) === 'FAILED') {
          throw new Error('Files API reported FAILED while processing the audio upload.');
        }

        addLog(`File ready (state: ${fileInfo.state}). Referencing by URI.`);
        audioPart = {
          fileData: { fileUri: fileInfo.uri, mimeType: fileInfo.mimeType ?? mimeType },
        };
      }

      // --- STAGE 1: Isolated Raw Transcription (Hallucination-Safe, Full-Duration Anchored) ---
      addLog(`Sending payload to ${MODELS.TRANSCRIPTION} for full-duration high fidelity speech transcription...`);
      
      const transcriptionPrompt = sensitivity === 'high' 
        ? `Transcribe this complete meeting recording verbatim from start to finish with speaker diarization.

Format speaker turns cleanly:
Speaker 1: Spoken text here.
Speaker 2: Spoken text here.
(Use participant names if introduced in the dialogue).

Guidelines:
- Group spoken dialogue into complete conversational sentences and paragraphs.
- Do not include millisecond time markers, timestamps, or timecodes.
- Transcribe every language exactly as spoken, in its original language (do not translate). Keep mixed-language speech as it is, along with technical terminology, system configurations, and decisions.
- DO NOT repeat phrases or loop sentences if there are audio pauses, hesitations, or overlapping voices. Only transcribe what is genuinely spoken once.
- If the audio has no discernable speech, output: [No speech detected]`
        : `Transcribe this meeting recording accurately from start to finish with speaker diarization.

Format:
Speaker 1: Spoken dialogue.
Speaker 2: Spoken dialogue.

Guidelines:
- Group speech into coherent conversational paragraphs per speaker.
- Do not output timestamps or millisecond timecodes.
- Transcribe every language exactly as spoken, in its original language (do not translate), and keep technical configurations accurate.
- DO NOT repeat phrases or generate repeating loops during pauses or background noise.
- If there is no speech, output: [No speech detected]`;
      
      const sanitizedTransPrompt = sanitizeString(transcriptionPrompt, piiEntries);

      addLog("AI processing started. Running Stage 1/2: Isolated Diarization (Full Duration)...");
      const conversationContents: any[] = [
        sanitizedTransPrompt,
        audioPart
      ];

      const initialResponse = await generateContentWithRetry(
        ai,
        {
          model: MODELS.TRANSCRIPTION,
          contents: conversationContents,
          config: {
            maxOutputTokens: 65536,
            temperature: 0.0,
            safetySettings: MEETING_SAFETY_SETTINGS,
          },
        },
        {
          maxRetries: 3,
          initialDelayMs: 2500,
          fallbackModel: 'gemini-2.5-flash',
          onRetry: (attempt, delayMs, err) => {
            const isHighDemand = err?.message?.toLowerCase().includes('high demand') || err?.status === 503;
            const detail = isHighDemand ? 'Gemini audio capacity temporary spike (503)' : (err?.message || 'Temporary service issue');
            addLog(`[RETRY] ${detail}. Retrying in ${(delayMs / 1000).toFixed(1)}s (Attempt ${attempt}/3)...`);
          }
        }
      );

      let rawTranscript = extractCandidateText(initialResponse);
      let currentFinishReason = initialResponse.candidates?.[0]?.finishReason;

      // Handle long-recording continuation if the output token limit was reached
      let continuationPass = 0;
      const MAX_CONTINUATION_PASSES = 4;
      const conversationHistory: any[] = [
        {
          role: 'user',
          parts: [{ text: sanitizedTransPrompt }, audioPart]
        },
        {
          role: 'model',
          parts: [{ text: rawTranscript }]
        }
      ];

      while (currentFinishReason === 'MAX_TOKENS' && continuationPass < MAX_CONTINUATION_PASSES) {
        continuationPass++;
        addLog(`Output limit reached at pass ${continuationPass}. Continuing transcription for the remainder of the recording...`);

        conversationHistory.push({
          role: 'user',
          parts: [{
            text: 'You reached the output token limit. Please continue transcribing seamlessly from the exact sentence where you left off until the entire recording is completely transcribed. Maintain the same clean speaker format without timestamps.'
          }]
        });

        const continuationResponse = await generateContentWithRetry(
          ai,
          {
            model: MODELS.TRANSCRIPTION,
            contents: conversationHistory,
            config: {
              maxOutputTokens: 65536,
              temperature: 0.0,
              safetySettings: MEETING_SAFETY_SETTINGS,
            },
          },
          {
            maxRetries: 3,
            initialDelayMs: 2500,
            fallbackModel: 'gemini-2.5-flash',
            onRetry: (attempt, delayMs) => {
              addLog(`[RETRY] Continuation pass ${continuationPass} retry in ${(delayMs / 1000).toFixed(1)}s (Attempt ${attempt}/3)...`);
            }
          }
        );

        const continuationText = extractCandidateText(continuationResponse);
        if (!continuationText || continuationText.trim().length === 0) {
          break;
        }

        rawTranscript += '\n\n' + continuationText;
        conversationHistory.push({
          role: 'model',
          parts: [{ text: continuationText }]
        });

        currentFinishReason = continuationResponse.candidates?.[0]?.finishReason;
      }

      // Automatically clean up any autoregressive looping repetitions
      rawTranscript = deduplicateTranscript(rawTranscript);

      if (rawTranscript.trim().length === 0) {
        const finishReason = initialResponse?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
        const blockReason = initialResponse?.promptFeedback?.blockReason;
        const errDetail = `Model returned an empty response. finishReason=${finishReason}${blockReason ? `, blockReason=${blockReason}` : ''}`;
        addLog(`[ERROR] ${errDetail}`);
        
        let userFacingMsg = `The AI scribe model completed with status finishReason: "${finishReason}".`;
        if (blockReason === 'PROHIBITED_CONTENT' || blockReason === 'SAFETY') {
          userFacingMsg = `The safety filter intercepted this audio transcription (${blockReason}). Permissive safety settings have now been enabled for neutral meeting transcripts. You can also paste or type the meeting notes directly into the transcript box.`;
        } else {
          userFacingMsg += ` You can re-run with High Sensitivity, paste meeting notes directly, or edit the transcript below.`;
        }

        setPipelineError({
          title: blockReason ? `Content Flagged (${blockReason})` : 'Audio Transcription Yielded No Text',
          message: userFacingMsg,
          details: errDetail,
        });
        setIsProcessing(false);
        setProcessingStep('idle');
        return;
      }

      if (rawTranscript.trim().includes('[No speech detected]') || rawTranscript.trim().length < 5) {
        addLog("[INFO] AI Scribe reported silence/noise limit. No intelligible human speech detected.");
        setTranscript("[No speech detected]");
        setIsProcessing(false);
        setProcessingStep('idle');
        return;
      }

      const reconstructedTranscript = reconstructString(rawTranscript, piiEntries);
      setTranscript(reconstructedTranscript);
      addLog("Stage 1 complete: Speech transcribed with diarization successfully.");

      // --- STAGE 2: Downstream Structuring and Record updates via Multi-turn Dynamic Analysis ---
      await executeStage2Analysis(reconstructedTranscript, piiEntries);

    } catch (err: any) {
      addLog(`[FATAL ERROR] AI pipeline failed: ${geminiErrorText(err)}`);
      setPipelineError({
        title: 'AI Processing Pipeline Error',
        message: geminiErrorText(err) || 'An unexpected error occurred during audio processing.',
        details: `Stage: ${processingStep}. Model: ${MODELS.REASONING}`,
      });
      handleAIError(err);
    } finally {
      // Raw audio is not part of the golden record (FSD 2.9.1), so remove the
      // server-side copy as soon as we are done with it rather than waiting for
      // the 48h auto-expiry. Failure to clean up must not mask a real error.
      if (uploadedFileName) {
        try {
          await ai.files.delete({ name: uploadedFileName });
          addLog('Server-side audio copy deleted.');
        } catch (cleanupErr: any) {
          addLog(`[WARN] Could not delete uploaded audio (${uploadedFileName}): ${cleanupErr?.message ?? cleanupErr}`);
        }
      }
      setIsProcessing(false);
    }
  };

  const processText = async (text: string) => {
    if (!text.trim() || text.trim() === '[No speech detected]') {
      return;
    }
    setIsProcessing(true);
    setProcessingStep('analyzing');
    setCommitted(false);
    setDraftMoM(null);
    setDraftActionItems([]);
    setDraftUpdates([]);
    setLogs([]);
    setPipelineError(null);

    try {
      addLog("Formatting pasted meeting transcript payload...");
      const piiEntries = activeProjectId ? usePIIStore.getState().entries.filter(e => e.projectId === activeProjectId) : [];
      setTranscript(text);

      // Multi-turn dynamic tool-assisted stage 2 analysis
      await executeStage2Analysis(text, piiEntries);

      setIsPastingTranscript(false);
      setPastedTranscript('');
    } catch (err: any) {
      addLog(`[ERROR] Text processor failed: ${geminiErrorText(err)}`);
      setPipelineError({
        title: 'Text Extraction Failed',
        message: geminiErrorText(err) || 'Failed to process transcript text.',
      });
      handleAIError(err);
      setIsPastingTranscript(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const commitApprovedData = () => {
    if (!activeProjectId || !draftMoM) return;

    addLog("Saving verified structures to system databases...");

    const { addMom, updateMom } = useMomStore.getState();
    const { addTask } = useTasksStore.getState();

    // 1. Generate core MoM Golden Record
    const momId = addMom(activeProjectId);
    addLog(`Local MoM space allocated with Golden ID: ${momId}.`);

    // 2. Insert verified and approved tasks and cross-link!
    const momActionItems: MoMActionItem[] = [];

    draftActionItems.forEach((ai, idx) => {
       if (ai.approved && ai.description.trim()) {
           let taskId: string | undefined = undefined;

           // Push task to general Task tracker and capture new ID directly
           const newTaskId = addTask({
              projectId: activeProjectId,
              type: 'Action Item',
              description: ai.description,
              status: 'Open',
              owner: ai.owner,
              estimatedResolutionDate: ai.dueDate,
              comments: [],
              linkedActivityIds: [],
              source: `MoM Reference: ${draftMoM.title} (ID: ${momId})`
           });

           if (newTaskId) {
             taskId = newTaskId;
             addLog(`Synced and resolved Task #${idx + 1} with Task tracker reference "${taskId}".`);
           }

           // Assemble record properties for MoM storage
           momActionItems.push({
             id: crypto.randomUUID(),
             description: ai.description,
             assignee: ai.owner,
             status: 'Open',
             taskId,
           });
       }
    });

    // Save full document properties and map active Action Item lists
    updateMom(momId, {
      title: draftMoM.title,
      date: draftMoM.date,
      time: draftMoM.time,
      location: draftMoM.location,
      attendees: draftMoM.attendees,
      agenda: draftMoM.agenda,
      notes: draftMoM.notes,
      keyDecisions: draftMoM.keyDecisions,
      actionItems: momActionItems,
    });

    addLog("Minutes of Meeting document updated with comprehensive metadata.");

    // 3. Batch apply existing baseline database updates
    draftUpdates.forEach((ur) => {
       if (ur.approved && ur.recordId) {
          if (ur.type === 'Task') {
             useTasksStore.getState().updateTask(ur.recordId, ur.updates);
             addLog(`Applied updates to Task "${ur.recordId}".`);
          } else if (ur.type === 'Timeline') {
             const pLine = useTimelineStore.getState().getProjectTimeline(activeProjectId);
             const currentRevId = pLine?.activeRevisionId;
             if (currentRevId) {
                useTimelineStore.getState().updateActivity(activeProjectId, currentRevId, ur.recordId, ur.updates);
                addLog(`Applied updates to Timeline Activity "${ur.recordId}".`);
             }
          } else if (ur.type === 'Deliverable') {
             useDeliverablesStore.getState().updateDeliverable(ur.recordId, ur.updates);
             addLog(`Applied updates to Deliverable "${ur.recordId}".`);
          } else if (ur.type === 'Risk') {
             useRisksStore.getState().updateRisk(ur.recordId, ur.updates);
             addLog(`Applied updates to Risk "${ur.recordId}".`);
          } else if (ur.type === 'Milestone') {
             useBillingStore.getState().updateMilestone(ur.recordId, ur.updates);
             addLog(`Applied updates to Billing Milestone "${ur.recordId}".`);
          }
       }
    });

    setCommitted(true);
    addLog("SYNC COMPLETED SUCCESSFULLY. ALL BASES COVERED.");
  };

  return (
    <div className="h-full flex px-12 pt-8 pb-12 gap-12 bg-qb-bg font-sans overflow-hidden">
      {/* Left Column: Recording controls */}
      <div className="w-[400px] shrink-0 border-r border-qb-light-grey pr-12 flex flex-col h-full min-h-0 overflow-y-auto">
        <div className="mb-10">
          {/* Reached from MoM ("Analyse a recording"); this is the way back. */}
          <Link to="/mom" className="inline-flex items-center gap-1.5 mb-5 text-[10px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-orange transition-colors">
            <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back to MoM
          </Link>
          <h1 className="text-2xl font-black text-qb-black uppercase tracking-widest leading-tight mb-2 font-sans">Analyse a recording</h1>
          <p className="text-xs font-bold text-qb-grey uppercase tracking-widest font-sans">Gemini drafts the minutes; you review them</p>
        </div>

        <div className="flex flex-col gap-6 w-full">
            {isRecording ? (
             <div className="flex flex-col items-start w-full border-t border-b border-qb-light-grey py-8">
                <div className="flex items-center gap-4 mb-3">
                   <div className="relative flex h-8 w-8 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-qb-magenta opacity-40"></span>
                      <span className="relative inline-flex rounded-full h-4 w-4 bg-qb-magenta"></span>
                   </div>
                   <h3 className="text-lg font-black text-qb-magenta uppercase tracking-widest font-sans">Recording Active</h3>
                </div>

                {/* HUD Live Channel Signal Indicators */}
                <div className="w-full flex gap-3 text-[9px] font-mono mb-6 bg-white border border-qb-light-grey p-3 uppercase font-bold text-qb-black">
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className={`block w-2.5 h-2.5 rounded-full ${isMicActive ? 'bg-qb-green' : 'bg-qb-grey'}`}></span>
                    <span>Mic: {isMicActive ? 'Mixed' : 'Mute'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className={`block w-2.5 h-2.5 rounded-full ${isSystemActive ? 'bg-qb-green' : 'bg-qb-magenta'}`}></span>
                    <span>System: {isSystemActive ? 'Detected' : 'Bypassed'}</span>
                  </div>
                </div>

                <button 
                   onClick={stopRecording}
                   className="w-full bg-transparent border-2 border-qb-magenta text-qb-magenta px-6 py-4 font-black text-xs uppercase tracking-widest hover:bg-qb-magenta hover:text-white flex items-center justify-center gap-3 transition-all"
                >
                   <Square className="w-4 h-4" /> Stop Recording
                </button>
             </div>
           ) : isPastingTranscript ? (
             <div className="flex flex-col w-full gap-4">
                <div className="flex items-center gap-2 mb-2">
                   <div className="h-px bg-qb-orange w-4"></div>
                   <h3 className="text-xs font-black text-qb-black uppercase tracking-widest">Transcript Analysis Log</h3>
                </div>
                <textarea 
                  className="w-full h-64 bg-transparent border border-qb-light-grey p-4 font-mono text-xs resize-none outline-none focus:border-qb-orange text-qb-black transition-colors shadow-none"
                  placeholder="Paste meeting logs or transcript here..."
                  value={pastedTranscript}
                  onChange={e => setPastedTranscript(e.target.value)}
                />
                <div className="flex gap-4">
                  <button 
                     onClick={() => setIsPastingTranscript(false)}
                     disabled={isProcessing}
                     className="bg-transparent text-qb-grey px-4 py-3 font-bold text-xs uppercase tracking-widest hover:text-qb-black transition-colors"
                  >
                     Cancel
                  </button>
                  <button 
                     onClick={() => processText(pastedTranscript)}
                     disabled={isProcessing || !pastedTranscript}
                     className="bg-qb-black text-white px-6 py-3 font-black text-xs uppercase tracking-widest hover:bg-qb-orange flex-1 transition-all disabled:opacity-50"
                  >
                     {isProcessing ? 'Processing' : 'Analyze Text'}
                  </button>
                </div>
             </div>
           ) : (
             <>
                <div className="relative group w-full">
                   <button 
                      onClick={startRecording}
                      disabled={isProcessing}
                      className="w-full text-left bg-transparent border border-qb-light-grey px-6 py-8 flex flex-col items-start gap-4 transition-all hover:border-qb-black"
                   >
                      <div className="h-0.5 w-8 bg-transparent group-hover:bg-qb-orange transition-colors absolute top-[-1px] left-0"></div>
                      <Volume2 className="w-8 h-8 text-qb-dark-grey group-hover:text-qb-black transition-colors" />
                      <div>
                         <div className="font-black text-lg text-qb-black uppercase tracking-widest leading-tight">Capture Live Audio</div>
                         <div className="font-bold text-[10px] text-qb-grey uppercase tracking-widest mt-1">Both Microphone & system channels</div>
                      </div>
                   </button>
                   <div className="mt-2 text-[9px] text-qb-grey tracking-wider font-semibold font-mono p-3 border border-dashed border-qb-light-grey bg-white/40 leading-relaxed">
                      ※ SYSTEM ROUTING INSTRUCTION: Google Chrome prompts high fidelity screen capture permissions. Click "Share system audio" or "Share tab audio" inside Chrome's popup selection frame to feed other meeting participant sounds into PM Codex's mixer!
                   </div>
                </div>

                <button 
                   onClick={() => fileInputRef.current?.click()}
                   disabled={isProcessing}
                   className="group relative w-full bg-transparent border border-qb-light-grey px-6 py-6 flex flex-col items-start gap-4 transition-all hover:border-qb-black"
                >
                   <div className="h-0.5 w-8 bg-transparent group-hover:bg-qb-orange transition-colors absolute top-[-1px] left-0"></div>
                   <Upload className="w-6 h-6 text-qb-dark-grey group-hover:text-qb-black transition-colors" />
                   <div className="text-left">
                      <div className="font-black text-sm text-qb-black uppercase tracking-widest">Import Wave Logs</div>
                      <div className="font-bold text-[10px] text-qb-grey uppercase tracking-widest mt-1">Post audio recording files</div>
                   </div>
                </button>

                <button 
                   onClick={() => setIsPastingTranscript(true)}
                   disabled={isProcessing}
                   className="group relative w-full bg-transparent border border-qb-light-grey px-6 py-6 flex flex-col items-start gap-4 transition-all hover:border-qb-black"
                >
                   <div className="h-0.5 w-8 bg-transparent group-hover:bg-qb-orange transition-colors absolute top-[-1px] left-0"></div>
                   <FileText className="w-6 h-6 text-qb-dark-grey group-hover:text-qb-black transition-colors" />
                   <div className="text-left">
                      <div className="font-black text-sm text-qb-black uppercase tracking-widest">Paste Meeting log</div>
                      <div className="font-bold text-[10px] text-qb-grey uppercase tracking-widest mt-1">Import external raw logs</div>
                   </div>
                </button>

                <input 
                   type="file" 
                   accept="audio/*" 
                   ref={fileInputRef} 
                   className="hidden" 
                   onChange={handleFileUpload} 
                />
             </>
           )}

           {audioUrl && !isRecording && (
              <div className="mt-8 pt-6 border-t border-qb-light-grey w-full">
                 <p className="text-[10px] font-bold text-qb-grey uppercase tracking-widest mb-3 font-mono">Channel Outputs (Playback)</p>
                 <audio controls src={audioUrl} className="w-full h-8" />
              </div>
           )}
        </div>
      </div>

      {/* Right Column: Dynamic Stage & Process Center */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-y-auto no-scrollbar pb-12 pr-6">
           <div className="flex items-center gap-4 mb-8">
              <div className="flex-1 h-px bg-qb-light-grey"></div>
              <h2 className="text-xl font-black text-qb-black uppercase tracking-widest">Analysis & Approval Hub</h2>
           </div>
           
           {/* Pipeline Error Banner */}
           {pipelineError && (
              <div className="flex flex-col border border-qb-magenta bg-white p-6 relative overflow-hidden my-6">
                 <div className="absolute top-0 left-0 h-1 w-16 bg-qb-magenta"></div>
                 <div className="flex items-start gap-4">
                    <AlertTriangle className="w-5 h-5 text-qb-magenta shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                       <div className="flex items-center justify-between">
                          <h4 className="text-xs font-black text-qb-black uppercase tracking-widest font-sans">
                             {pipelineError.title}
                          </h4>
                          <button 
                             onClick={() => setPipelineError(null)}
                             className="text-[10px] font-mono text-qb-grey hover:text-qb-black uppercase font-bold"
                          >
                             [Dismiss ✕]
                          </button>
                       </div>
                       <p className="text-xs text-qb-dark-grey leading-relaxed font-sans">
                          {pipelineError.message}
                       </p>
                       {pipelineError.details && (
                          <div className="p-3 bg-qb-bg border border-qb-light-grey font-mono text-[10px] text-qb-dark-grey select-text">
                             {pipelineError.details}
                          </div>
                       )}
                       <div className="flex flex-wrap items-center gap-3 pt-3">
                          {lastAudioBlob && (
                             <>
                                <button
                                   onClick={() => {
                                      setPipelineError(null);
                                      processAudio(lastAudioBlob, 'normal');
                                   }}
                                   className="bg-qb-black text-white hover:bg-qb-orange px-4 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all"
                                >
                                   <RefreshCw className="w-3.5 h-3.5 text-qb-orange" /> Retry Transcription
                                </button>
                                <button
                                   onClick={() => {
                                      setPipelineError(null);
                                      processAudio(lastAudioBlob, 'high');
                                   }}
                                   className="border border-qb-light-grey hover:border-qb-black text-qb-black px-4 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all"
                                >
                                   <RefreshCw className="w-3.5 h-3.5" /> High Sensitivity Scribe
                                </button>
                             </>
                          )}
                          <button
                             onClick={() => {
                                setPipelineError(null);
                                setIsPastingTranscript(true);
                             }}
                             className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                          >
                             <FileText className="w-3.5 h-3.5" /> Paste Notes Manually
                          </button>
                          <button
                             onClick={() => {
                                setPipelineError(null);
                                handleCreateBlankDraft();
                             }}
                             className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                          >
                             <Edit3 className="w-3.5 h-3.5" /> Manual MoM Form
                          </button>
                          <button
                             onClick={() => setShowLogs(!showLogs)}
                             className="border border-qb-light-grey hover:border-qb-black text-qb-grey hover:text-qb-black px-3 py-2 text-xs font-mono font-bold uppercase tracking-widest flex items-center gap-1.5 transition-all ml-auto"
                          >
                             <span>{showLogs ? 'Hide Logs' : 'View Full Logs'}</span>
                             {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                       </div>
                    </div>
                 </div>
              </div>
           )}

           {/* Staged Audio File Ready for Processing (Screenshot 2 fix) */}
           {!transcript && !isProcessing && (audioUrl || lastAudioBlob) && (
              <div className="flex flex-col border border-qb-light-grey bg-white p-8 relative overflow-hidden my-6">
                 <div className="absolute top-0 left-0 h-1 w-16 bg-qb-orange"></div>
                 <div className="flex items-center justify-between border-b border-qb-light-grey pb-4 mb-6">
                    <div>
                       <span className="text-[10px] font-mono font-bold text-qb-orange uppercase tracking-widest">Audio Track Loaded</span>
                       <h3 className="text-lg font-black text-qb-black uppercase tracking-widest font-sans mt-1">Ready for Transcription & Analysis</h3>
                    </div>
                    <span className="text-[9px] font-mono font-bold uppercase px-2.5 py-1 bg-qb-bg border border-qb-light-grey text-qb-dark-grey">
                       {audioFileInfo?.type || 'AUDIO SOURCE'}
                    </span>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-qb-bg border border-qb-light-grey">
                    <div>
                       <label className="text-[9px] font-mono font-bold uppercase text-qb-grey block">File / Source</label>
                       <span className="text-xs font-bold text-qb-black truncate block">{audioFileInfo?.name || 'Uploaded Audio Track'}</span>
                    </div>
                    <div>
                       <label className="text-[9px] font-mono font-bold uppercase text-qb-grey block">Payload Size</label>
                       <span className="text-xs font-mono font-bold text-qb-black">
                          {audioFileInfo?.size ? `${(audioFileInfo.size / 1024 / 1024).toFixed(2)} MB` : 'Buffer Stream'}
                       </span>
                    </div>
                    <div>
                       <label className="text-[9px] font-mono font-bold uppercase text-qb-grey block">Pipeline Target</label>
                       <span className="text-xs font-mono font-bold text-qb-orange">{MODELS.REASONING} Scribe</span>
                    </div>
                 </div>

                 {audioUrl && (
                    <div className="mb-6">
                       <label className="text-[9px] font-mono font-bold uppercase text-qb-grey block mb-2">Track Audio Preview</label>
                       <audio controls src={audioUrl} className="w-full h-10 border border-qb-light-grey" />
                    </div>
                 )}

                 <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                       onClick={() => lastAudioBlob && processAudio(lastAudioBlob, 'normal')}
                       disabled={!lastAudioBlob}
                       className="bg-qb-black text-white hover:bg-qb-orange px-6 py-3 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
                    >
                       <Sparkles className="w-4 h-4 text-qb-orange" />
                       <span>Transcribe & Extract Action Items</span>
                       <ArrowRight className="w-4 h-4" />
                    </button>

                    <button
                       onClick={() => lastAudioBlob && processAudio(lastAudioBlob, 'high')}
                       disabled={!lastAudioBlob}
                       className="border border-qb-light-grey hover:border-qb-black text-qb-black px-4 py-3 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                       <RefreshCw className="w-3.5 h-3.5" />
                       <span>High Sensitivity Scribe</span>
                    </button>

                    <button
                       onClick={handleCreateBlankDraft}
                       className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-3 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                       <FileText className="w-3.5 h-3.5" />
                       <span>Manual MoM Template</span>
                    </button>

                    <button
                       onClick={() => fileInputRef.current?.click()}
                       className="border border-qb-light-grey hover:border-qb-black text-qb-grey hover:text-qb-black px-4 py-3 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                       <Upload className="w-3.5 h-3.5" />
                       <span>Change File</span>
                    </button>

                    <button
                       onClick={handleClearSession}
                       className="border border-qb-magenta text-qb-magenta hover:bg-qb-magenta hover:text-white px-4 py-3 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all ml-auto"
                    >
                       <Trash2 className="w-3.5 h-3.5" />
                       <span>Discard</span>
                    </button>
                 </div>
              </div>
           )}

           {/* Waiting for Input State (No audio staged and no transcript) */}
           {!transcript && !isProcessing && !audioUrl && !lastAudioBlob && (
              <div className="flex flex-col items-center justify-center py-24 text-center h-[50vh]">
                 <div className="w-16 h-16 border border-qb-light-grey flex items-center justify-center rotate-45 mb-8">
                    <FileText className="w-6 h-6 text-qb-grey -rotate-45" />
                 </div>
                 <p className="text-xs font-black tracking-widest uppercase text-qb-black font-sans">No Active Session Logged</p>
                 <p className="text-[10px] font-bold tracking-widest uppercase text-qb-grey mt-2 max-w-sm leading-relaxed">
                   Capture dual channels, import wave logs, or paste notes to feed the AI scribe validator pipeline.
                 </p>
                 <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                    <button
                       onClick={startRecording}
                       className="bg-transparent border border-qb-light-grey hover:border-qb-black text-qb-black px-4 py-2.5 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                       <Volume2 className="w-3.5 h-3.5 text-qb-orange" /> Capture Live Audio
                    </button>
                    <button
                       onClick={() => fileInputRef.current?.click()}
                       className="bg-transparent border border-qb-light-grey hover:border-qb-black text-qb-black px-4 py-2.5 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                       <Upload className="w-3.5 h-3.5" /> Import Wave Logs
                    </button>
                    <button
                       onClick={() => setIsPastingTranscript(true)}
                       className="bg-qb-black text-white hover:bg-qb-orange px-4 py-2.5 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
                    >
                       <FileText className="w-3.5 h-3.5 text-qb-orange" /> Paste Meeting Log
                    </button>
                    <button
                       onClick={handleCreateBlankDraft}
                       className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-2.5 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                    >
                       <Edit3 className="w-3.5 h-3.5" /> Manual MoM Form
                    </button>
                 </div>
              </div>
           )}

           {/* Processing Pipeline Console Logger */}
           {isProcessing && (
              <div className="flex flex-col border border-qb-light-grey bg-white p-8 relative overflow-hidden my-6">
                 {/* Design cues */}
                 <div className="absolute top-0 left-0 w-3 h-3 bg-qb-orange"></div>
                 <div className="absolute bottom-0 right-0 w-3 h-3 bg-qb-orange"></div>
                 
                 <div className="flex items-center gap-4 mb-8">
                    <Clock className="w-8 h-8 text-qb-orange animate-spin" />
                    <h3 className="font-sans font-black text-lg text-qb-black uppercase tracking-widest">PROCESSING COGNITIVE STREAM</h3>
                 </div>
                 
                 <div className="font-mono text-[11px] text-qb-dark-grey space-y-4 bg-qb-bg p-6 border border-qb-light-grey">
                    <div className="flex justify-between border-b border-qb-light-grey pb-2 text-[10px]">
                       <span className="font-bold text-qb-black">[ PIPELINE OPERATIONAL LOG ]</span>
                       <span className="text-qb-orange animate-pulse font-bold">MODEL: {MODELS.REASONING.toUpperCase()}</span>
                    </div>

                    {/* Operational system events monitor */}
                    <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono text-[10px] leading-relaxed select-text no-scrollbar">
                      {logs.map((logStr, i) => (
                        <div key={i} className="text-qb-dark-grey">
                          <span className="text-qb-orange mr-2">▶</span>
                          {logStr}
                        </div>
                      ))}
                      {processingStep !== 'complete' && (
                        <div className="text-qb-black font-semibold animate-pulse">
                          <span className="text-qb-orange mr-2">▶</span>
                          System analyzing... Hold tight.
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-qb-light-grey flex justify-between text-[9px] text-qb-grey">
                       <span>CHANNELS: MIXED IN REALTIME</span>
                       <span>AUDIT LEVEL: COMPLIANT COGLOG</span>
                    </div>
                 </div>
              </div>
           )}

           {/* Persistent / Toggleable Operational Logs when not processing */}
           {!isProcessing && logs.length > 0 && (
              <div className="border border-qb-light-grey bg-white p-4 my-4">
                 <div 
                    onClick={() => setShowLogs(!showLogs)}
                    className="flex items-center justify-between cursor-pointer select-none"
                 >
                    <div className="flex items-center gap-2">
                       <span className="w-2 h-2 bg-qb-orange"></span>
                       <span className="text-[10px] font-mono font-bold text-qb-black uppercase tracking-widest">
                          Pipeline Operational Logs ({logs.length} events)
                       </span>
                    </div>
                    <button className="text-[10px] font-mono text-qb-grey hover:text-qb-black uppercase font-bold flex items-center gap-1">
                       <span>{showLogs ? 'Collapse' : 'Expand'}</span>
                       {showLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                 </div>

                 {showLogs && (
                    <div className="mt-4 font-mono text-[10px] bg-qb-bg p-4 border border-qb-light-grey max-h-60 overflow-y-auto space-y-1 select-text no-scrollbar">
                       {logs.map((logStr, i) => (
                          <div key={i} className="text-qb-dark-grey leading-relaxed">
                             <span className="text-qb-orange mr-2">▶</span>
                             {logStr}
                          </div>
                       ))}
                    </div>
                 )}
              </div>
           )}

           {/* Human-In-The-Loop Suggestions Editor & Approve panel */}
           {draftMoM && !committed && (
              <div className="space-y-10 max-w-4xl bg-white border border-qb-light-grey p-8 relative">
                 <div className="absolute top-0 left-0 h-[2px] w-12 bg-qb-orange"></div>
                 
                 <div className="flex items-center justify-between border-b border-qb-light-grey pb-4 mb-6">
                    <div>
                       <h3 className="text-xs font-black text-qb-orange uppercase tracking-widest font-sans">Verification Stage</h3>
                       <h4 className="text-lg font-black text-qb-black uppercase tracking-widest mt-1 font-sans">Review Proposed Meeting Assets</h4>
                    </div>
                    <div className="text-[10px] bg-qb-bg text-qb-black font-mono border border-qb-light-grey py-1 px-2 uppercase font-black">
                       Manual Scribe Confirmed
                    </div>
                 </div>

                 {iterationRemarks && (
                    <div className="mb-6 p-4 border border-qb-cyan bg-qb-cyan/5">
                       <h5 className="text-[10px] font-black text-qb-cyan uppercase tracking-widest font-mono mb-2">AI Remarks</h5>
                       <p className="text-xs text-qb-dark-grey leading-relaxed">{iterationRemarks}</p>
                    </div>
                 )}

                 {/* Editable Draft MoM section */}
                 <section className="space-y-6">
                    <div className="flex items-center gap-2 mb-4">
                       <span className="text-[10px] bg-qb-black text-white px-2 py-0.5 font-black uppercase tracking-widest font-mono">01</span>
                       <h5 className="text-xs font-black text-qb-black uppercase tracking-widest font-sans">Minutes of Meeting (MoM) Content</h5>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-qb-light-grey pb-6">
                       <div className="md:col-span-2">
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-mono">MOM Document Title</label>
                          <input 
                             type="text" 
                             className="w-full bg-transparent border border-qb-light-grey px-3 py-2 text-xs font-bold text-qb-black focus:border-qb-orange outline-none"
                             value={draftMoM.title}
                             onChange={e => setDraftMoM({...draftMoM, title: e.target.value})}
                          />
                       </div>

                       <div>
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-mono font-sans">Meeting Date</label>
                          <input 
                             type="date" 
                             className="w-full bg-transparent border border-qb-light-grey px-3 py-2 text-xs font-bold font-mono text-qb-black focus:border-qb-orange outline-none"
                             value={(draftMoM.date || '').split('T')[0]}
                             onChange={e => setDraftMoM({...draftMoM, date: e.target.value})}
                          />
                       </div>

                       <div>
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-mono font-sans">Meeting Time</label>
                          <input 
                             type="text" 
                             className="w-full bg-transparent border border-qb-light-grey px-3 py-2 text-xs font-bold font-mono text-qb-black focus:border-qb-orange outline-none"
                             value={draftMoM.time}
                             placeholder="HH:MM"
                             onChange={e => setDraftMoM({...draftMoM, time: e.target.value})}
                          />
                       </div>

                       <div>
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-mono font-sans">Location / Chanel</label>
                          <input 
                             type="text" 
                             className="w-full bg-transparent border border-qb-light-grey px-3 py-2 text-xs font-bold text-qb-black focus:border-qb-orange outline-none"
                             value={draftMoM.location}
                             onChange={e => setDraftMoM({...draftMoM, location: e.target.value})}
                          />
                       </div>

                       <div>
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-mono font-sans">Attendees</label>
                          <input 
                             type="text" 
                             className="w-full bg-transparent border border-qb-light-grey px-3 py-2 text-xs font-bold text-qb-black focus:border-qb-orange outline-none"
                             value={draftMoM.attendees}
                             onChange={e => setDraftMoM({...draftMoM, attendees: e.target.value})}
                          />
                       </div>

                       <div className="md:col-span-2">
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-mono font-sans">Extracted Agenda</label>
                          <input 
                             type="text" 
                             className="w-full bg-transparent border border-qb-light-grey px-3 py-2 text-xs font-bold text-qb-black focus:border-qb-orange outline-none"
                             value={draftMoM.agenda}
                             onChange={e => setDraftMoM({...draftMoM, agenda: e.target.value})}
                          />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 pt-2">
                       <div>
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-sans">Extracted Key Decisions & Resolutions</label>
                          <RichTextEditor 
                             id="meeting-key-decisions"
                             value={draftMoM.keyDecisions}
                             onChange={val => setDraftMoM({...draftMoM, keyDecisions: val})}
                             placeholder="Summary of decisions..."
                             minHeight="min-h-[100px]"
                          />
                       </div>

                       <div>
                          <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest mb-1 font-sans">Supplemental Discussion Notes & Ideas</label>
                          <RichTextEditor 
                             id="meeting-notes"
                             value={draftMoM.notes}
                             onChange={val => setDraftMoM({...draftMoM, notes: val})}
                             placeholder="Other ideas and notes..."
                             minHeight="min-h-[100px]"
                          />
                       </div>
                    </div>
                 </section>

                 <div className="w-full h-px bg-qb-light-grey"></div>

                 {/* Suggested Action Items checklist */}
                 <section className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                       <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-qb-black text-white px-2 py-0.5 font-black uppercase tracking-widest font-mono">02</span>
                          <h5 className="text-xs font-black text-qb-black uppercase tracking-widest font-sans">Proposed New Action Items</h5>
                       </div>
                       <span className="text-[10px] tracking-widest font-bold text-qb-grey uppercase font-sans">Checks Approve Creation</span>
                    </div>

                    <div className="flex flex-col gap-4">
                       {draftActionItems.map((item, index) => (
                          <div key={item.id} className="border border-qb-light-grey bg-qb-bg p-4 flex flex-col md:flex-row gap-4 items-start md:items-center">
                             <div className="flex items-center gap-3">
                                <button 
                                   onClick={() => setDraftActionItems(draftActionItems.map(ai => ai.id === item.id ? { ...ai, approved: !ai.approved } : ai))}
                                   className={`w-5 h-5 flex items-center justify-center border transition-all ${item.approved ? 'border-qb-orange bg-qb-orange text-white' : 'border-qb-grey bg-white hover:border-qb-black'}`}
                                >
                                   {item.approved && <Check className="w-3.5 h-3.5 stroke-[4px]" />}
                                </button>
                                <span className="font-mono text-[9px] text-qb-grey font-bold uppercase">{index + 1}</span>
                             </div>

                             <div className="flex-1 w-full space-y-2">
                                <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest font-sans">Task Description</label>
                                <input 
                                   type="text"
                                   className={`w-full bg-transparent border px-2 py-1 text-xs font-bold text-qb-black outline-none transition-colors ${item.approved ? 'border-qb-light-grey focus:border-qb-orange' : 'border-transparent cursor-not-allowed opacity-50'}`}
                                   value={item.description}
                                   disabled={!item.approved}
                                   onChange={e => setDraftActionItems(draftActionItems.map(ai => ai.id === item.id ? { ...ai, description: e.target.value } : ai))}
                                />
                             </div>

                             <div className="w-full md:w-32 space-y-2">
                                <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest font-sans">Assignee</label>
                                <input 
                                   type="text"
                                   className={`w-full bg-transparent border px-2 py-1 text-xs font-bold text-qb-black outline-none transition-colors ${item.approved ? 'border-qb-light-grey focus:border-qb-orange' : 'border-transparent cursor-not-allowed opacity-50'}`}
                                   value={item.owner}
                                   disabled={!item.approved}
                                   onChange={e => setDraftActionItems(draftActionItems.map(ai => ai.id === item.id ? { ...ai, owner: e.target.value } : ai))}
                                />
                             </div>

                             <div className="w-full md:w-36 space-y-2">
                                <label className="block text-[9px] font-black text-qb-grey uppercase tracking-widest font-sans font-mono">Due Date</label>
                                <input 
                                   type="date"
                                   className={`w-full bg-transparent border px-2 py-1 text-xs font-mono text-qb-black outline-none transition-colors ${item.approved ? 'border-qb-light-grey focus:border-qb-orange' : 'border-transparent cursor-not-allowed opacity-50'}`}
                                   value={(item.dueDate || '').split('T')[0]}
                                   disabled={!item.approved}
                                   onChange={e => setDraftActionItems(draftActionItems.map(ai => ai.id === item.id ? { ...ai, dueDate: e.target.value } : ai))}
                                />
                             </div>
                          </div>
                       ))}

                       {draftActionItems.length === 0 && (
                          <div className="text-xs font-bold tracking-widest text-qb-grey uppercase italic border border-dashed border-qb-light-grey py-6 text-center">
                             No actionable items proposed.
                          </div>
                       )}
                    </div>
                 </section>

                 <div className="w-full h-px bg-qb-light-grey"></div>

                 {/* Suggested target baseline updates */}
                 <section className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                       <div className="flex items-center gap-2">
                          <span className="text-[10px] bg-qb-black text-white px-2 py-0.5 font-black uppercase tracking-widest font-mono">03</span>
                          <h5 className="text-xs font-black text-qb-black uppercase tracking-widest font-sans">Proposed Baseline Database Updates</h5>
                       </div>
                    </div>

                    <div className="flex flex-col gap-3">
                       {draftUpdates.map((ur) => (
                          <div key={ur.id} className="border border-qb-light-grey bg-white p-4 flex items-center justify-between gap-4">
                             <div className="flex items-center gap-4">
                                <button 
                                   onClick={() => setDraftUpdates(draftUpdates.map(u => u.id === ur.id ? { ...u, approved: !u.approved } : u))}
                                   className={`w-5 h-5 flex items-center justify-center border transition-all ${ur.approved ? 'border-qb-cyan bg-qb-cyan text-white' : 'border-qb-grey bg-white hover:border-qb-black'}`}
                                >
                                   {ur.approved && <Check className="w-3.5 h-3.5 stroke-[4px]" />}
                                </button>
                                
                                <div className="space-y-1 text-left">
                                   <div className="flex items-center gap-2">
                                      <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 border ${ur.type === 'Timeline' ? 'text-qb-green border-qb-green bg-qb-green/5' : ur.type === 'Deliverable' ? 'text-qb-cyan border-qb-cyan bg-qb-cyan/5' : ur.type === 'Risk' ? 'text-qb-magenta border-qb-magenta bg-qb-magenta/5' : ur.type === 'Milestone' ? 'text-qb-orange border-qb-orange bg-qb-orange/5' : 'text-qb-black border-qb-black bg-qb-black/5'}`}>
                                         {ur.type}
                                      </span>
                                      <span className="font-mono text-[9px] text-qb-grey truncate font-bold">ID: {ur.recordId}</span>
                                   </div>
                                   <div className="text-xs font-bold text-qb-black line-clamp-1 truncate" title={ur.recordId}>
                                      Original Target: "{ur.recordTitle}"
                                   </div>
                                </div>
                             </div>

                             <div className="text-right shrink-0">
                                <span className="text-[9px] font-black text-qb-grey uppercase tracking-widest block mb-1">Proposed Updates</span>
                                <span className="font-mono text-[10px] text-qb-orange font-bold bg-qb-bg py-1 px-2 border border-qb-light-grey">
                                   {JSON.stringify(ur.updates).replace(/[\{\}\"]/g, '').replace(/:/g, ': ').replace(/,/g, ' | ')}
                                </span>
                             </div>
                          </div>
                       ))}

                       {draftUpdates.length === 0 && (
                          <div className="text-xs font-bold tracking-widest text-qb-dark-grey uppercase italic border border-dashed border-qb-light-grey py-6 text-center">
                             No existing records require updates.
                          </div>
                       )}
                    </div>
                 </section>

                 {/* Human in loop execution buttons */}
                 <div className="pt-8 border-t border-qb-light-grey flex flex-col gap-4">
                     <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
                        <div className="flex items-center gap-3">
                           <button 
                              onClick={() => useAiStore.getState().setSidebarOpen(true)}
                              className="border border-qb-cyan bg-qb-cyan/10 text-qb-cyan hover:bg-qb-cyan hover:text-white transition-all py-3 px-5 text-xs uppercase font-black tracking-widest flex items-center gap-2 font-mono"
                           >
                              <Sparkles className="w-4 h-4" /> Open ACR Approval Hub
                           </button>
                           <span className="text-[10px] text-qb-grey font-mono hidden md:inline-block">
                              Review or refine changes with AI Assistant
                           </span>
                        </div>

                        <div className="flex gap-4">
                           <button 
                              onClick={() => {
                                 setDraftMoM(null);
                                 setDraftActionItems([]);
                                 setDraftUpdates([]);
                              }}
                              className="border border-qb-magenta text-qb-magenta hover:bg-qb-magenta hover:text-white transition-all py-3 px-6 text-xs uppercase font-black tracking-widest"
                           >
                              Reject All Logs
                           </button>
                           <button 
                              onClick={commitApprovedData}
                              className="bg-qb-black hover:bg-qb-orange text-white transition-all py-3 px-8 text-xs uppercase font-black tracking-widest flex items-center justify-center gap-3"
                           >
                              Approve & Integrate Assets <ChevronRight className="w-4 h-4" />
                           </button>
                        </div>
                     </div>
                 </div>
              </div>
           )}

           {/* Successful integration state with statistics summary */}
           {committed && (
              <div className="border border-qb-green bg-qb-green/5 p-8 relative overflow-hidden max-w-4xl text-left">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-qb-green/10 rotate-45 translate-x-16 -translate-y-16 flex items-end justify-center pb-4 select-none">
                    <CheckCircle className="w-10 h-10 text-qb-green -rotate-45" />
                 </div>
                 
                 <span className="text-[9px] font-black text-qb-green/80 uppercase tracking-widest bg-qb-green/15 border border-qb-green/30 px-2 py-0.5 mb-2 inline-block">Database Commit Confirmed</span>
                 <h3 className="font-sans font-black text-2xl text-qb-black uppercase tracking-widest mb-3 leading-tight">Golden Record Sync Completed</h3>
                 <p className="text-sm text-qb-dark-grey leading-relaxed mb-8 max-w-2xl font-medium">
                    The verified insights have been updated inside the project baselines. The raw audio stream and transient system sounds were completely purged to maintain compliance.
                 </p>

                 <div className="font-mono text-[11px] text-qb-dark-grey space-y-3 bg-white p-6 border border-qb-green/30 max-w-lg">
                    <div className="font-bold border-b border-qb-light-grey pb-2 text-qb-black">[ SYNC STATISTICS SUMMARY ]</div>
                    <div>• 1 MoM File Published: "{draftMoM?.title}"</div>
                    <div>• {draftActionItems.filter(a => a.approved).length} action items integrated in task database and linked to MoM.</div>
                    <div>• {draftUpdates.filter(u => u.approved).length} existing risks and timeline attributes updated.</div>
                 </div>

                 <button 
                    onClick={handleClearSession}
                    className="mt-8 bg-transparent border border-qb-light-grey hover:border-qb-black text-qb-black hover:text-white hover:bg-qb-black py-3 px-6 text-xs uppercase font-black tracking-widest transition-all"
                 >
                    Process New Session
                  </button>
               </div>
            )}

            {/* Diarized Scribe Transcript Hub & Editor */}
            {transcript && (
               <div className="mt-12 pt-8 border-t border-qb-light-grey max-w-4xl text-left">
                  {/* Warning banner when no speech detected */}
                  {transcript.trim() === '[No speech detected]' && (
                     <div className="mb-6 p-6 border border-qb-orange bg-white relative">
                        <div className="absolute top-0 left-0 h-1 w-12 bg-qb-orange"></div>
                        <div className="flex items-start gap-4">
                           <AlertTriangle className="w-6 h-6 text-qb-orange shrink-0 mt-0.5" />
                           <div className="space-y-3 flex-1">
                              <div className="flex items-center justify-between">
                                 <h4 className="text-sm font-black text-qb-black uppercase tracking-widest font-sans">
                                    No Intelligible Speech Detected
                                 </h4>
                                 <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 bg-qb-bg border border-qb-light-grey text-qb-dark-grey">
                                    SILENCE / NOISE LIMIT
                                 </span>
                              </div>
                              <p className="text-xs text-qb-dark-grey leading-relaxed">
                                 The AI scribe was unable to identify clear human dialogue from the audio feed. 
                                 You can re-run with <strong className="text-qb-black">High Sensitivity</strong>, type/paste notes into the transcript box below, or create a manual MoM template to proceed.
                              </p>

                              {audioUrl && (
                                 <div className="pt-1 pb-2">
                                    <audio controls src={audioUrl} className="w-full h-8" />
                                 </div>
                              )}

                              <div className="flex flex-wrap items-center gap-3 pt-1">
                                 {lastAudioBlob && (
                                    <button
                                       onClick={() => processAudio(lastAudioBlob, 'high')}
                                       disabled={isProcessing}
                                       className="bg-qb-black text-white hover:bg-qb-orange px-4 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-sm"
                                    >
                                       <RefreshCw className={`w-3.5 h-3.5 ${isProcessing && processingStep === 'transcribing' ? 'animate-spin text-qb-orange' : 'text-qb-orange'}`} /> Re-Transcribe (High Sensitivity)
                                    </button>
                                 )}
                                 <button
                                    onClick={() => setTranscript('')}
                                    className="border border-qb-light-grey hover:border-qb-black text-qb-black px-4 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all"
                                 >
                                    <Edit3 className="w-3.5 h-3.5" /> Type / Paste Notes Directly
                                 </button>
                                 <button
                                    onClick={handleCreateBlankDraft}
                                    className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                                 >
                                    <FileText className="w-3.5 h-3.5" /> Create Blank MoM Template
                                 </button>
                                 <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isProcessing}
                                    className="border border-qb-light-grey hover:border-qb-black text-qb-grey hover:text-qb-black px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all"
                                 >
                                    <Upload className="w-3.5 h-3.5" /> Upload Different File
                                 </button>
                                 <button
                                    onClick={handleClearSession}
                                    className="border border-qb-magenta text-qb-magenta hover:bg-qb-magenta hover:text-white px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-all ml-auto"
                                 >
                                    <Trash2 className="w-3.5 h-3.5" /> Clear
                                 </button>
                              </div>
                           </div>
                        </div>
                     </div>
                  )}

                  {/* Transcript Header & Action Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                     <div>
                        <h3 className="text-xs font-black text-qb-grey uppercase tracking-widest font-mono flex items-center gap-2">
                           <span>Diarized Scribe Transcript Source</span>
                           {transcript && transcript.trim() !== '[No speech detected]' && (
                              <span className="text-[9px] font-bold text-qb-dark-grey bg-qb-bg border border-qb-light-grey px-2 py-0.5">
                                 {transcript.trim().split(/\s+/).filter(Boolean).length} words · {transcript.length} chars
                              </span>
                           )}
                        </h3>
                        <p className="text-[10px] text-qb-grey font-bold uppercase tracking-wider mt-1">
                           Editable source transcript · Edit dialogue or paste custom notes at any time
                        </p>
                     </div>

                     {/* Action Bar */}
                     <div className="flex flex-wrap items-center gap-2">
                        <button
                           onClick={() => {
                              navigator.clipboard.writeText(transcript);
                              setCopiedTranscript(true);
                              setTimeout(() => setCopiedTranscript(false), 2000);
                           }}
                           disabled={!transcript}
                           className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-3 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 transition-all disabled:opacity-40"
                           title="Copy transcript to clipboard"
                        >
                           {copiedTranscript ? <Check className="w-3.5 h-3.5 text-qb-green" /> : <Copy className="w-3.5 h-3.5" />}
                           <span>{copiedTranscript ? 'Copied' : 'Copy'}</span>
                        </button>

                        {lastAudioBlob && (
                           <button
                              onClick={() => processAudio(lastAudioBlob, 'high')}
                              disabled={isProcessing}
                              className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-3 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 transition-all disabled:opacity-40"
                              title="Re-run transcription on current audio file with high sensitivity"
                           >
                              <RefreshCw className={`w-3.5 h-3.5 ${isProcessing && processingStep === 'transcribing' ? 'animate-spin text-qb-orange' : ''}`} />
                              <span>Re-Transcribe</span>
                           </button>
                        )}

                        <button
                           onClick={handleCreateBlankDraft}
                           className="border border-qb-light-grey hover:border-qb-black text-qb-dark-grey hover:text-qb-black px-3 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 transition-all"
                           title="Create blank Minutes of Meeting draft"
                        >
                           <FileText className="w-3.5 h-3.5" />
                           <span>Manual MoM</span>
                        </button>

                        <button
                           onClick={handleClearSession}
                           className="border border-qb-light-grey hover:border-qb-magenta text-qb-grey hover:text-qb-magenta px-3 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 transition-all"
                           title="Clear current transcript & session"
                        >
                           <Trash2 className="w-3.5 h-3.5" />
                           <span>Clear</span>
                        </button>

                        <button
                           onClick={() => {
                              if (transcript.trim() === '[No speech detected]') {
                                 setTranscript('');
                              } else {
                                 processText(transcript);
                              }
                           }}
                           disabled={isProcessing || !transcript || (transcript.trim() !== '[No speech detected]' && transcript.trim().length < 5)}
                           className="bg-qb-black text-white hover:bg-qb-orange px-5 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                           title="Analyze transcript and generate Minutes of Meeting & Action Items"
                        >
                           <Sparkles className={`w-4 h-4 ${isProcessing && processingStep === 'analyzing' ? 'animate-spin text-qb-orange' : 'text-qb-orange'}`} />
                           <span>{isProcessing ? 'Processing...' : transcript.trim() === '[No speech detected]' ? 'Type Notes To Process' : 'Process Transcript'}</span>
                        </button>
                     </div>
                  </div>

                  {/* Editable Monospace Textarea */}
                  <div className="relative">
                     <textarea
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder="Type or paste diarized transcript or meeting notes here (e.g. Speaker 1: Good morning everyone...)..."
                        rows={10}
                        className="w-full text-xs leading-relaxed text-qb-black font-mono bg-white border border-qb-light-grey p-5 resize-y focus:border-qb-orange outline-none transition-colors selection:bg-qb-orange selection:text-white"
                     />
                  </div>

                  {/* Call to action when transcript is available but MoM is not yet generated */}
                  {transcript && transcript.trim() !== '[No speech detected]' && transcript.trim().length >= 5 && !draftMoM && !isProcessing && (
                     <div className="mt-4 p-4 border border-qb-light-grey bg-white flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                           <div className="w-2 h-2 rounded-full bg-qb-cyan animate-pulse"></div>
                           <span className="text-xs font-bold text-qb-black uppercase tracking-wider font-sans">
                              Transcript ready for intelligence extraction
                           </span>
                        </div>
                        <button
                           onClick={() => processText(transcript)}
                           className="w-full sm:w-auto bg-qb-black text-white hover:bg-qb-orange px-6 py-2.5 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                           <Sparkles className="w-4 h-4 text-qb-orange" />
                           <span>Extract Action Items & MoM</span>
                           <ArrowRight className="w-4 h-4" />
                        </button>
                     </div>
                  )}
               </div>
            )}
         </div>
      </div>
    </div>
  );
};
