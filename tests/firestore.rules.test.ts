import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const databaseId = 'ai-studio-e316c560-bff4-411c-9095-0c6d6acbe77f';
const projectId = 'demo-chatflow';
let environment: RulesTestEnvironment;
let chatId: string;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  chatId = `chat_${crypto.randomUUID().replaceAll('-', '')}`;
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await database.doc(`chats/${chatId}`).set({
      chatId,
      participants: ['alice', 'bob'],
      type: 'one-to-one',
      createdAt: new Date(),
    });
    await database.doc(`chats/${chatId}/messages/original`).set({
      messageId: 'original',
      chatId,
      senderId: 'alice',
      text: 'Original message',
      type: 'text',
      timestamp: new Date(),
      status: 'sent',
    });
  });
  await seedStorageChat(chatId);
});

after(async () => {
  await environment?.clearStorage();
  await environment?.cleanup();
});

test('only conversation participants can read a chat and its messages', async () => {
  const alice = environment.authenticatedContext('alice', { email_verified: true }).firestore();
  const outsider = environment.authenticatedContext('mallory', { email_verified: true }).firestore();

  await assertSucceeds(alice.doc(`chats/${chatId}`).get());
  await assertSucceeds(alice.collection(`chats/${chatId}/messages`).get());
  await assertFails(outsider.doc(`chats/${chatId}`).get());
  await assertFails(outsider.collection(`chats/${chatId}/messages`).get());
  await assertFails(environment.unauthenticatedContext().firestore().doc(`chats/${chatId}`).get());
});

test('participants can create messages, but outsiders cannot', async () => {
  const alice = environment.authenticatedContext('alice', { email_verified: true }).firestore();
  const outsider = environment.authenticatedContext('mallory', { email_verified: true }).firestore();
  const message = {
    messageId: 'new-message',
    chatId,
    senderId: 'alice',
    text: 'A new message',
    type: 'text',
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    status: 'sent',
  };

  await assertSucceeds(alice.doc(`chats/${chatId}/messages/new-message`).set(message));
  await assertFails(outsider.doc(`chats/${chatId}/messages/outsider-message`).set({
    ...message,
    messageId: 'outsider-message',
    senderId: 'mallory',
  }));
});

test('only the message sender can edit or delete their message', async () => {
  const alice = environment.authenticatedContext('alice', { email_verified: true }).firestore();
  const bob = environment.authenticatedContext('bob', { email_verified: true }).firestore();
  const message = alice.doc(`chats/${chatId}/messages/original`);

  await assertFails(bob.doc(`chats/${chatId}/messages/original`).update({
    text: 'Changed by another participant',
    isEdited: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }));
  await assertSucceeds(message.update({
    text: 'Edited by the sender',
    isEdited: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }));
  await assertFails(bob.doc(`chats/${chatId}/messages/original`).delete());
  await assertSucceeds(message.delete());
});

test(`conversation access cannot be granted by a participant's client update`, async () => {
  const alice = environment.authenticatedContext('alice', { email_verified: true }).firestore();

  await assertFails(alice.doc(`chats/${chatId}`).update({
    participants: ['alice', 'bob', 'mallory'],
  }));
});

test('chat attachments are restricted to participants and validated on upload', async () => {
  const alice = environment.authenticatedContext('alice', { email_verified: true }).storage();
  const bob = environment.authenticatedContext('bob', { email_verified: true }).storage();
  const outsider = environment.authenticatedContext('mallory', { email_verified: true }).storage();
  const attachmentPath = `chats/${chatId}/alice/attachment.png`;
  const attachment = alice.ref(attachmentPath);

  await assertSucceeds(attachment.put(new Uint8Array([137, 80, 78, 71]), {
    contentType: 'image/png',
  }));
  await assertSucceeds(attachment.getMetadata());
  await assertFails(outsider.ref(attachmentPath).getMetadata());
  await assertFails(bob.ref(`chats/${chatId}/alice/other.png`).put(new Uint8Array([1]), {
    contentType: 'image/png',
  }));
  await assertFails(bob.ref(`chats/${chatId}/bob/invalid.txt`).put(new Uint8Array([1]), {
    contentType: 'text/plain',
  }));
});

async function seedStorageChat(id: string): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:8080/v1/projects/${projectId}/databases/${databaseId}/documents/chats/${id}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer owner',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          chatId: { stringValue: id },
          participants: {
            arrayValue: { values: [{ stringValue: 'alice' }, { stringValue: 'bob' }] },
          },
          type: { stringValue: 'one-to-one' },
          createdAt: { timestampValue: new Date().toISOString() },
        },
      }),
    },
  );

  assert.equal(response.ok, true, `Failed to seed Storage rules fixture: ${await response.text()}`);
}
