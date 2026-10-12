import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

export const geminiService = {
  async summarizeChat(messages: { text: string; senderName: string }[]): Promise<string> {
    return callAi<string>('summarizeChat', { messages });
  },

  async suggestSmartReplies(lastMessage: string, context?: string): Promise<string[]> {
    return callAi<string[]>('suggestSmartReplies', { lastMessage, context });
  },

  async generateTaskDetails(messageText: string): Promise<{ title: string; category: string }> {
    return callAi<{ title: string; category: string }>('generateTaskDetails', { messageText });
  },

  async improveWriting(text: string, tone: 'professional' | 'friendly' | 'concise' | 'humorous' = 'friendly'): Promise<string> {
    return callAi<string>('improveWriting', { text, tone });
  }
};

async function callAi<T>(
  operation: 'summarizeChat' | 'suggestSmartReplies' | 'generateTaskDetails' | 'improveWriting',
  payload: Record<string, unknown>,
): Promise<T> {
  const callable = httpsCallable<{ operation: string; payload: Record<string, unknown> }, T>(
    functions,
    'aiAssist',
  );
  const response = await callable({ operation, payload });
  return response.data;
}
