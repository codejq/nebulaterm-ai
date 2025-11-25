
import React from 'react';
import { Session } from '../types';
import { X, Terminal as TerminalIcon } from 'lucide-react';

interface TabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCloseSession: (id: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({ sessions, activeSessionId, onSelectSession, onCloseSession }) => {
  if (sessions.length === 0) return null;

  return (
    <div className="flex items-end bg-gray-950 border-b border-gray-800 pt-1 px-1 gap-1 overflow-x-auto select-none no-scrollbar">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`
            group relative flex items-center gap-2 pl-3 pr-2 py-2 min-w-[150px] max-w-[200px] cursor-pointer rounded-t-lg transition-all border-x
            ${activeSessionId === session.id 
              ? 'bg-[#0d1117] border-gray-800 border-b-[#0d1117] text-gray-200 border-t-2' 
              : 'bg-gray-900 border-transparent text-gray-500 hover:bg-gray-800 hover:text-gray-300 border-t border-t-transparent'
            }
          `}
          style={{
            borderTopColor: activeSessionId === session.id ? session.color : 'transparent'
          }}
          onClick={() => onSelectSession(session.id)}
          title={session.name}
        >
          {/* Color Dot (always visible) */}
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: session.color }} />

          <div className="flex-1 flex flex-col overflow-hidden">
             <span className="text-xs font-medium truncate leading-tight">{session.name}</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseSession(session.id);
            }}
            className={`p-0.5 rounded-md hover:bg-gray-700/50 ${activeSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          >
            <X className="w-3 h-3" />
          </button>
          
          {/* Active Tab connector visual fix */}
          {activeSessionId === session.id && (
             <div className="absolute -bottom-[1px] left-0 right-0 h-[1px] bg-[#0d1117] z-10" />
          )}
        </div>
      ))}
      
      {/* Scroll area padding */}
      <div className="flex-1" />
    </div>
  );
};

export default TabBar;