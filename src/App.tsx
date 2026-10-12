/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { EmptyState } from './components/EmptyState';
import { CallingProvider } from './context/CallingContext';

const CallInsights = lazy(() => import('./components/CallInsights').then((module) => ({
  default: module.CallInsights,
})));

function ChatApp() {
  const { user, loading } = useAuth();
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chats' | 'insights'>('chats');

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#F0F2F5]">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00A884] border-t-transparent" />
          <p className="text-sm font-medium text-gray-500">Loading Echo Chat...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[#F0F2F5] p-0 lg:p-4">
      <div className="flex h-full w-full overflow-hidden rounded-none shadow-2xl bg-white lg:rounded-lg">
        <div className={`h-full w-full shrink-0 md:flex md:w-[380px] ${selectedChatId && viewMode === 'chats' ? 'hidden' : 'flex'}`}>
          <Sidebar
            selectedChatId={selectedChatId}
            onSelectChat={(id) => {
              setSelectedChatId(id);
              setViewMode('chats');
            }}
            onViewInsights={() => {
              setViewMode('insights');
              setSelectedChatId(null);
            }}
          />
        </div>
        {viewMode === 'insights' ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-gray-500">Loading call insights…</div>}>
            <CallInsights />
          </Suspense>
        ) : selectedChatId ? (
          <div className={`h-full w-full min-w-0 ${selectedChatId && viewMode === 'chats' ? 'flex' : 'hidden md:flex'}`}>
            <ChatWindow chatId={selectedChatId} onBack={() => setSelectedChatId(null)} />
          </div>
        ) : (
          <div className="hidden h-full min-w-0 flex-1 md:flex">
            <EmptyState />
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CallingProvider>
        <ChatApp />
      </CallingProvider>
    </AuthProvider>
  );
}
