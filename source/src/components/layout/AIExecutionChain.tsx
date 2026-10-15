import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Brain, Database, Hammer } from 'lucide-react';
import { Content } from '@google/genai';
import { GeminiIcon } from '../icons/GeminiIcon';
import { AIResponseRenderer } from './AIResponseRenderer';

export interface TraceElement {
  id: string;
  type: 'thought' | 'query' | 'action';
  text?: string;
  title?: string;
  durationSeconds?: number;
  functionCall?: any;
  response?: any;
}

interface AIExecutionChainProps {
  thoughtContent?: string;
  thoughtTitle?: string;
  thoughtDurationSeconds?: number;
  queryFuncs?: any[];
  mutationFuncs?: any[];
  nextMessage?: Content;
  isStreaming?: boolean;
  traceElements?: TraceElement[];
}

export const AIExecutionChain: React.FC<AIExecutionChainProps> = ({
  thoughtContent,
  thoughtTitle,
  thoughtDurationSeconds,
  queryFuncs = [],
  mutationFuncs = [],
  nextMessage,
  isStreaming = false,
  traceElements,
}) => {
  const [mainExpanded, setMainExpanded] = useState(true);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // Helper to find response for fallback mode
  const findResponseForCall = (name: string, id?: string) => {
    if (!nextMessage?.parts) return null;
    const responsePart = nextMessage.parts.find(p => 
      p.functionResponse && (
        (id && p.functionResponse.id === id) || 
        p.functionResponse.name === name
      )
    );
    return responsePart?.functionResponse?.response;
  };

  // Convert legacy props to unified trace elements if not provided
  const unifiedElements = useMemo(() => {
    if (traceElements) return traceElements;

    const list: TraceElement[] = [];
    if (thoughtContent) {
      list.push({
        id: 'thought-fallback',
        type: 'thought',
        text: thoughtContent,
        title: thoughtTitle,
        durationSeconds: thoughtDurationSeconds,
      });
    }

    queryFuncs.forEach((fc, idx) => {
      const callName = fc.functionCall?.name || '';
      const callId = fc.functionCall?.id;
      list.push({
        id: `query-fallback-${idx}`,
        type: 'query',
        functionCall: fc.functionCall,
        response: findResponseForCall(callName, callId),
      });
    });

    mutationFuncs.forEach((fc, idx) => {
      const callName = fc.functionCall?.name || '';
      const callId = fc.functionCall?.id;
      list.push({
        id: `action-fallback-${idx}`,
        type: 'action',
        functionCall: fc.functionCall,
        response: findResponseForCall(callName, callId),
      });
    });

    return list;
  }, [traceElements, thoughtContent, thoughtTitle, queryFuncs, mutationFuncs, nextMessage]);

  if (unifiedElements.length === 0) return null;

  const toggleItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  return (
    <div className="bg-qb-box-bg border border-qb-light-grey border-l-2 border-l-qb-orange w-full text-xs flex flex-col font-sans transition-all duration-300">
      {/* Main Expander Header */}
      <button
        onClick={() => setMainExpanded(!mainExpanded)}
        className="flex items-center justify-between p-3 hover:bg-qb-light-grey/20 transition-colors w-full text-left outline-none"
      >
        <div className="flex items-center gap-2">
          <GeminiIcon className={`w-3.5 h-3.5 ${isStreaming ? 'animate-pulse text-qb-orange' : 'text-qb-black'}`} />
          <span className="font-bold uppercase tracking-widest text-qb-black text-[11px] flex items-center gap-1.5">
            Actions Performed
            <span className="text-[10px] font-mono text-qb-grey lowercase font-normal italic">
              ({unifiedElements.length} element{unifiedElements.length !== 1 ? 's' : ''})
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <span className="text-[9px] bg-qb-orange text-white px-1.5 py-0.5 font-bold uppercase tracking-widest animate-pulse">
              STREAMING
            </span>
          )}
          {mainExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-qb-grey" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-qb-grey" />
          )}
        </div>
      </button>

      {/* Main Content Area */}
      {mainExpanded && (
        <div className="border-t border-dashed border-qb-light-grey p-3 flex flex-col gap-2.5 bg-white/20">
          {unifiedElements.map((el) => {
            const isItemExp = !!expandedItems[el.id];

            if (el.type === 'thought') {
              const match = el.text?.match(/^\s*#+\s+([^\n]+)/m);
              const headerTitle = match ? match[1].trim() : null;
              const displayTitle = headerTitle || el.title || 'Thoughts';
              
              return (
                <div key={el.id} className="border border-qb-light-grey bg-qb-bg/40 flex flex-col">
                  <button
                    onClick={(e) => toggleItem(el.id, e)}
                    className="flex items-center justify-between p-2 hover:bg-qb-light-grey/20 transition-colors w-full text-left outline-none"
                  >
                    <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-qb-dark-grey text-[10px]">
                      <Brain className="w-3.5 h-3.5 text-qb-grey" />
                      <span>{displayTitle}</span>
                      {el.durationSeconds !== undefined && el.durationSeconds > 0 && (
                        <span className="font-mono text-[9px] text-qb-grey lowercase font-normal italic">
                          Thought for {el.durationSeconds} seconds
                        </span>
                      )}
                    </div>
                    {isItemExp ? (
                      <ChevronDown className="w-3.5 h-3.5 text-qb-grey" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-qb-grey" />
                    )}
                  </button>
                  {isItemExp && (
                    <div className="p-3 border-t border-qb-light-grey bg-white/50 overflow-hidden font-mono text-[11px]">
                      <AIResponseRenderer content={el.text || ''} variant="mono" />
                    </div>
                  )}
                </div>
              );
            }

            if (el.type === 'query') {
              const callName = el.functionCall?.name || 'Unknown query';
              return (
                <div key={el.id} className="border border-qb-light-grey bg-qb-bg/40 flex flex-col">
                  <button
                    onClick={(e) => toggleItem(el.id, e)}
                    className="flex items-center justify-between p-2 hover:bg-qb-light-grey/20 transition-colors w-full text-left outline-none"
                  >
                    <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-qb-dark-grey text-[10px]">
                      <Database className="w-3.5 h-3.5 text-qb-orange" />
                      <span>Query: {callName}</span>
                    </div>
                    {isItemExp ? (
                      <ChevronDown className="w-3.5 h-3.5 text-qb-grey" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-qb-grey" />
                    )}
                  </button>
                  {isItemExp && (
                    <div className="p-3 border-t border-qb-light-grey bg-white/50 flex flex-col gap-3 font-mono text-[11px]">
                      {/* Arguments */}
                      <div>
                        <div className="text-[9px] uppercase font-black tracking-widest text-qb-grey mb-1">Arguments</div>
                        <pre className="text-[10px] text-qb-black bg-qb-bg border border-qb-light-grey p-2 overflow-x-auto whitespace-pre-wrap rounded-none">
                          {JSON.stringify(el.functionCall?.args || {}, null, 2)}
                        </pre>
                      </div>
                      {/* Tool Call Response */}
                      <div>
                        <div className="text-[9px] uppercase font-black tracking-widest text-qb-grey mb-1">Response Data</div>
                        <pre className="text-[10px] text-qb-dark-grey bg-qb-bg border border-qb-light-grey p-2 overflow-x-auto overflow-y-auto max-h-48 whitespace-pre-wrap select-all rounded-none">
                          {el.response ? JSON.stringify(el.response, null, 2) : (isStreaming ? 'Streaming...' : 'No response loaded or API call pending.')}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            if (el.type === 'action') {
              const callName = el.functionCall?.name || 'Unknown action';
              const beforeData = el.response?.beforeData;
              const afterData = el.response?.afterData;
              const isUpdate = !!beforeData && !!afterData;

              return (
                <div key={el.id} className="border border-qb-light-grey bg-qb-bg/40 flex flex-col">
                  <button
                    onClick={(e) => toggleItem(el.id, e)}
                    className="flex items-center justify-between p-2 hover:bg-qb-light-grey/20 transition-colors w-full text-left outline-none"
                  >
                    <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-qb-dark-grey text-[10px]">
                      <Hammer className="w-3.5 h-3.5 text-qb-orange" />
                      <span>Action: {callName}</span>
                    </div>
                    {isItemExp ? (
                      <ChevronDown className="w-3.5 h-3.5 text-qb-grey" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-qb-grey" />
                    )}
                  </button>
                  {isItemExp && (
                    <div className="p-3 border-t border-qb-light-grey bg-white/50 flex flex-col gap-3 font-mono text-[11px]">
                      {/* Arguments */}
                      <div>
                        <div className="text-[9px] uppercase font-black tracking-widest text-qb-grey mb-1">Arguments</div>
                        <pre className="text-[10px] text-qb-black bg-qb-bg border border-qb-light-grey p-2 overflow-x-auto whitespace-pre-wrap rounded-none">
                          {JSON.stringify(el.functionCall?.args || {}, null, 2)}
                        </pre>
                      </div>
                      {/* Response Diff or JSON */}
                      <div>
                        <div className="text-[9px] uppercase font-black tracking-widest text-qb-grey mb-1">Resulting State</div>
                        {isUpdate ? (
                          <div className="flex flex-col gap-2 mt-1">
                            <div className="overflow-x-auto whitespace-pre-wrap bg-qb-box-bg border border-qb-light-grey p-2">
                              <div className="font-bold text-qb-magenta mb-1 border-b border-qb-light-grey pb-1 uppercase tracking-widest text-[9px]">BEFORE</div>
                              <pre className="text-[10px] text-qb-grey">{JSON.stringify(beforeData, null, 2)}</pre>
                            </div>
                            <div className="overflow-x-auto whitespace-pre-wrap bg-white border border-qb-light-grey p-2">
                              <div className="font-bold text-qb-green mb-1 border-b border-qb-light-grey pb-1 uppercase tracking-widest text-[9px]">AFTER</div>
                              <pre className="text-[10px] text-qb-black">{JSON.stringify(afterData, null, 2)}</pre>
                            </div>
                          </div>
                        ) : (
                          <pre className="text-[10px] text-qb-dark-grey bg-qb-bg border border-qb-light-grey p-2 overflow-x-auto overflow-y-auto max-h-48 whitespace-pre-wrap select-all rounded-none">
                            {el.response ? JSON.stringify(el.response, null, 2) : (isStreaming ? 'Streaming...' : 'Action executed successfully.')}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
};
