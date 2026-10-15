import { create } from 'zustand';

interface MeetingsState {
  currentMeetingTranscript: string;
  currentMeetingAnalysisResult: any | null;
  draftMoM: any | null;
  draftActionItems: any[];
  draftUpdates: any[];
  
  setCurrentMeetingTranscript: (t: string) => void;
  setCurrentMeetingAnalysisResult: (a: any | null) => void;
  setDraftMoM: (mom: any | null) => void;
  setDraftActionItems: (items: any[]) => void;
  setDraftUpdates: (updates: any[]) => void;
}

export const useMeetingsStore = create<MeetingsState>((set) => ({
  currentMeetingTranscript: '',
  currentMeetingAnalysisResult: null,
  draftMoM: null,
  draftActionItems: [],
  draftUpdates: [],
  
  setCurrentMeetingTranscript: (t) => set({ currentMeetingTranscript: t }),
  setCurrentMeetingAnalysisResult: (a) => set({ currentMeetingAnalysisResult: a }),
  setDraftMoM: (mom) => set({ draftMoM: mom }),
  setDraftActionItems: (items) => set({ draftActionItems: items }),
  setDraftUpdates: (updates) => set({ draftUpdates: updates }),
}));
