import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { createSafeStorage } from '../utils/safeStorage';

export type DocumentType = 'Requirement' | 'Design' | 'Test' | 'Report' | 'Contract' | 'Manual' | 'Other';
export type DocumentStatus = 'Draft' | 'In Review' | 'Approved' | 'Archived';

export interface ProjectDocument {
  id: string;
  projectId: string;
  title: string;
  url: string;
  type: DocumentType | string;
  status: DocumentStatus | string;
  version: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  description: string;
}

interface DocumentsState {
  documents: ProjectDocument[];
  addDocument: (projectId: string, doc?: Partial<ProjectDocument>) => string;
  updateDocument: (id: string, updates: Partial<ProjectDocument>) => void;
  deleteDocument: (id: string) => void;
}

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set) => ({
      documents: [],
      addDocument: (projectId, doc) => {
        const id = uuidv4();
        const now = new Date().toISOString().split('T')[0];
        const newDoc: ProjectDocument = {
          id,
          projectId,
          title: 'Untitled Document',
          url: '',
          type: 'Other',
          status: 'Draft',
          version: '1.0',
          owner: '',
          createdAt: now,
          updatedAt: now,
          description: '',
          ...doc,
        };
        set((state) => ({ documents: [...state.documents, newDoc] }));
        return id;
      },
      updateDocument: (id, updates) =>
        set((state) => ({
          documents: state.documents.map((d) =>
            d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString().split('T')[0] } : d
          ),
        })),
      deleteDocument: (id) =>
        set((state) => ({
          documents: state.documents.filter((d) => d.id !== id),
        })),
    }),
    {
      name: 'pm-codex-documents',
      storage: createSafeStorage(),
    }
  )
);
