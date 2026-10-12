import { GoogleGenAI, Type } from '@google/genai';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

const app = initializeApp();

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const database = getFirestore(app, 'ai-studio-e316c560-bff4-411c-9095-0c6d6acbe77f');
const maxTextLength = 4000;

type AiOperation =
  | 'summarizeChat'
  | 'suggestSmartReplies'
  | 'generateTaskDetails'
  | 'improveWriting';

interface AiRequest {
  operation: AiOperation;
  payload: Record<string, unknown>;
}

export const aiAssist = onCall(
  { region: 'us-central1', secrets: [geminiApiKey], maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to use AI features.');
    }

    const { operation, payload } = validateRequest(request.data);
    await enforceRateLimit(request.auth.uid);

    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      return await runAiOperation(ai, operation, payload);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('AI operation failed', {
        operation,
        uid: request.auth.uid,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HttpsError('internal', 'The AI request could not be completed.');
    }
  },
);

function validateRequest(data: unknown): AiRequest {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'An AI operation and payload are required.');
  }

  const input = data as Record<string, unknown>;
  const allowedOperations: AiOperation[] = [
    'summarizeChat',
    'suggestSmartReplies',
    'generateTaskDetails',
    'improveWriting',
  ];
  if (!allowedOperations.includes(input.operation as AiOperation)) {
    throw new HttpsError('invalid-argument', 'Unsupported AI operation.');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new HttpsError('invalid-argument', 'A valid payload is required.');
  }

  return {
    operation: input.operation as AiOperation,
    payload: input.payload as Record<string, unknown>,
  };
}

async function enforceRateLimit(uid: string): Promise<void> {
  const now = Date.now();
  const minuteWindow = Math.floor(now / 60_000);
  const dayWindow = Math.floor(now / 86_400_000);
  const usageRef = database.doc(`aiUsage/${uid}`);

  await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const usage = snapshot.data();
    const minuteCount = usage?.minuteWindow === minuteWindow ? usage.minuteCount || 0 : 0;
    const dayCount = usage?.dayWindow === dayWindow ? usage.dayCount || 0 : 0;

    if (minuteCount >= 10 || dayCount >= 100) {
      throw new HttpsError('resource-exhausted', 'AI usage limit reached. Try again later.');
    }

    transaction.set(usageRef, {
      minuteWindow,
      minuteCount: minuteCount + 1,
      dayWindow,
      dayCount: dayCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function runAiOperation(
  ai: GoogleGenAI,
  operation: AiOperation,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (operation === 'summarizeChat') {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 50) {
      throw new HttpsError('invalid-argument', 'Provide between 1 and 50 messages.');
    }
    const context = messages.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new HttpsError('invalid-argument', 'Each message must include text and sender name.');
      }
      const message = entry as Record<string, unknown>;
      return `${boundedString(message.senderName, 'senderName', 100)}: ${boundedString(message.text, 'text', maxTextLength)}`;
    }).join('\n');
    return requireText(await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Summarize the conversation concisely and identify any action items.\n\n${context}`,
      config: { systemInstruction: 'Be concise and professional. Use bullets for action items.' },
    }));
  }

  if (operation === 'suggestSmartReplies') {
    const lastMessage = boundedString(payload.lastMessage, 'lastMessage', maxTextLength);
    const context = payload.context === undefined ? '' : boundedString(payload.context, 'context', maxTextLength);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Suggest 3 short, helpful replies to the latest message. Return only a JSON array of strings.\n\nLatest message: ${lastMessage}${context ? `\nContext: ${context}` : ''}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    });
    const parsed: unknown = JSON.parse(requireText(response));
    if (!Array.isArray(parsed) || parsed.length !== 3 || !parsed.every((reply) => typeof reply === 'string')) {
      throw new HttpsError('internal', 'The AI returned an invalid reply format.');
    }
    return parsed;
  }

  if (operation === 'generateTaskDetails') {
    const messageText = boundedString(payload.messageText, 'messageText', maxTextLength);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Extract a clear task title and category from this message: ${messageText}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { title: { type: Type.STRING }, category: { type: Type.STRING } },
          required: ['title', 'category'],
        },
      },
    });
    const parsed: unknown = JSON.parse(requireText(response));
    if (!parsed || typeof parsed !== 'object' || !('title' in parsed) || !('category' in parsed)) {
      throw new HttpsError('internal', 'The AI returned invalid task details.');
    }
    return {
      title: boundedString((parsed as Record<string, unknown>).title, 'title', 200),
      category: boundedString((parsed as Record<string, unknown>).category, 'category', 100),
    };
  }

  const text = boundedString(payload.text, 'text', maxTextLength);
  const tone = payload.tone;
  if (!['professional', 'friendly', 'concise', 'humorous'].includes(tone as string)) {
    throw new HttpsError('invalid-argument', 'Unsupported writing tone.');
  }
  return requireText(await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Rewrite this message in a ${tone} tone. Return only the rewritten message.\n\n${text}`,
  }));
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim();
}

function requireText(response: { text?: string }): string {
  const text = response.text?.trim();
  if (!text) throw new HttpsError('internal', 'The AI returned an empty response.');
  return text;
}
