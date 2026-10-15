import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Content } from '@google/genai';
import { createSafeStorage } from '../utils/safeStorage';

export interface AISession {
  id: string;
  projectId: string;
  title: string;
  messages: Content[];
  updatedAt: string;
}

interface AIState {
  sessions: AISession[];
  activeSessionId: string | null;
  isSidebarOpen: boolean;
  setSidebarOpen: (isOpen: boolean) => void;
  /**
   * True only while the sidebar is open BECAUSE a Claude ACR review forced it
   * open (ClaudeProposalBar, AppLayout.tsx) and it was closed before that.
   * Closing that review (X / sign off / reject — all funnel through
   * acrStore's setActiveAcrId(null)) reads this to decide whether to put the
   * sidebar back the way it was, instead of leaving the chat open when the
   * user never asked to see it. See PLAN.md section 17, 10 Sep entry.
   */
  sidebarOpenedByAcr: boolean;
  setSidebarOpenedByAcr: (opened: boolean) => void;
  createSession: (projectId: string, title?: string) => string;
  updateSessionMessages: (id: string, messages: Content[]) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, newTitle: string) => void;
  setActiveSessionId: (id: string | null) => void;
  getSessionsForProject: (projectId: string) => AISession[];
}

export const useAiStore = create<AIState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      isSidebarOpen: false,
      sidebarOpenedByAcr: false,

      setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
      setSidebarOpenedByAcr: (opened) => set({ sidebarOpenedByAcr: opened }),

      createSession: (projectId, title = 'New Conversation') => {
        const newSession: AISession = {
          id: Math.random().toString(36).substring(2, 9),
          projectId,
          title,
          messages: [],
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
          activeSessionId: newSession.id,
        }));
        return newSession.id;
      },

      updateSessionMessages: (id, messages) => {
        set((state) => ({
          sessions: state.sessions.map((s) => 
            s.id === id 
              ? { ...s, messages, updatedAt: new Date().toISOString() }
              : s
          )
        }));
      },

      deleteSession: (id) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
          activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        }));
      },

      renameSession: (id, newTitle) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title: newTitle, updatedAt: new Date().toISOString() } : s
          )
        }));
      },

      setActiveSessionId: (id) => {
        set({ activeSessionId: id });
      },

      getSessionsForProject: (projectId) => {
        return get().sessions.filter(s => !s.projectId || s.projectId === '' || s.projectId === projectId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }
    }),
    {
      name: 'pm-ai-storage', // unique name
      storage: createSafeStorage(),
      partialize: (state) => ({
        ...state,
        sessions: (state.sessions || [])
          .slice(0, 15) // Keep at most 15 sessions in localStorage
          .map((session) => ({
            ...session,
            messages: (session.messages || [])
              .slice(-25) // Keep only latest 25 messages per session in localStorage
              .map((m) => {
                if (!m.parts) return m;
                return {
                  ...m,
                  parts: m.parts
                    .filter((p: any) => !p.thought) // Strip large thought chains
                    .map((p: any) => {
                      if (p.inlineData && p.inlineData.data) {
                        return {
                          ...p,
                          inlineData: {
                            ...p.inlineData,
                            data: '', // Compact / strip large base64 data payload in localStorage
                          },
                        };
                      }
                      return p;
                    }),
                };
              }),
          })),
      }),
    }
  )
);
