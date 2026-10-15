import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSafeStorage } from '../utils/safeStorage';

interface IdAliasStore {
  realToAlias: Record<string, string>;
  aliasToReal: Record<string, string>;
  counters: Record<string, number>;
  getAlias: (realId: string | undefined, prefix: string) => string;
  getRealId: (aliasOrReal: string | undefined) => string | undefined;
  replaceRealWithAlias: (obj: any) => void;
  replaceAliasWithReal: (obj: any) => void;
}

/**
 * Aliases are handed out in the order records are first rendered, so without
 * persistence every page reload renumbered them. The same deliverable could be
 * DLV3 in one session and DEL46 in the next, which made any id written down
 * outside the app — in a note, in a past conversation, in the bridge — wrong.
 * Persisting the map fixes the numbering in place for good.
 */
export const useIdAliasStore = create<IdAliasStore>()(
  persist(
    (set, get) => ({

      realToAlias: {},
      aliasToReal: {},
      counters: {},
      getAlias: (realId: string | undefined, prefix: string) => {
        if (!realId) return '';
        const { realToAlias, counters } = get();
        if (realToAlias[realId]) return realToAlias[realId];
    
        const count = (counters[prefix] || 0) + 1;
        const alias = `${prefix}${count}`;
    
        set(state => ({
          realToAlias: { ...state.realToAlias, [realId]: alias },
          aliasToReal: { ...state.aliasToReal, [alias]: realId },
          counters: { ...state.counters, [prefix]: count }
        }));
    
        return alias;
      },
      getRealId: (aliasOrReal: string | undefined) => {
        if (!aliasOrReal) return undefined;
        const { aliasToReal } = get();
        // Use the alias if it exists, otherwise assume it's already a real ID
        return aliasToReal[aliasOrReal] || aliasOrReal;
      },
      // Both walkers replace strings held in arrays too. They used to recurse
      // into an array's items as if each were an object, so a string item —
      // linkedActivityIds: ["ACT3"], reportsToIds: ["STK2"] — was never
      // translated, and the record kept an alias no real id matches.
      replaceRealWithAlias: (obj: any) => {
        const internalReplace = (o: any) => {
          if (Array.isArray(o)) {
            o.forEach((item, i) => {
              if (typeof item === 'string') {
                const alias = get().realToAlias[item];
                if (alias) o[i] = alias;
              } else internalReplace(item);
            });
          } else if (typeof o === 'object' && o !== null) {
            for (const key in o) {
              if (typeof o[key] === 'string') {
                const alias = get().realToAlias[o[key]];
                if (alias) o[key] = alias;
              } else {
                internalReplace(o[key]);
              }
            }
          }
        };
        internalReplace(obj);
      },
      replaceAliasWithReal: (obj: any) => {
        const internalReplace = (o: any) => {
          if (Array.isArray(o)) {
            o.forEach((item, i) => {
              if (typeof item === 'string') {
                const real = get().aliasToReal[item];
                if (real) o[i] = real;
              } else internalReplace(item);
            });
          } else if (typeof o === 'object' && o !== null) {
            for (const key in o) {
              if (typeof o[key] === 'string') {
                const real = get().aliasToReal[o[key]];
                if (real) o[key] = real;
              } else {
                internalReplace(o[key]);
              }
            }
          }
        };
        internalReplace(obj);
      }
    }),
    {
      name: 'pm-codex-id-aliases',
      storage: createSafeStorage(),
      // Only the map is persisted; the functions are rebuilt on every load.
      partialize: (state) => ({
        realToAlias: state.realToAlias,
        aliasToReal: state.aliasToReal,
        counters: state.counters,
      }),
    }
  )
);
