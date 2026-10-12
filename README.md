# ChatFlow

ChatFlow is a React 19 + TypeScript messaging client built with Vite and Firebase. Google sign-in, chat history, presence, calls, profile data, and attachments use Firebase Auth, Cloud Firestore, and Cloud Storage. AI writing tools run in an authenticated Firebase callable function; the Gemini API key is never sent to the browser.

## Requirements

- Node.js 20 or newer
- A Firebase project with Google sign-in enabled
- Firebase CLI (`npm install --global firebase-tools`)
- Google Gemini API key (for AI tools)
- Google Cloud CLI (only if configuring Storage CORS for protected media)

## Local setup

```bash
npm ci
npm ci --prefix functions
npm run lint
npm run build
npm run test:rules
npm run dev
```

The development server is available at `http://localhost:3000`.

The Firebase web SDK configuration is read from `firebase-applet-config.json`. Firebase web configuration values, including the web API key, are identifiers used by the client and are not authorization controls; access is enforced by Firebase Authentication and the rules in this repository. Never put server credentials, service account keys, or the Gemini API key in this file or in a `VITE_*` variable.

## Firebase configuration

1. Enable **Google** under Firebase Authentication → Sign-in method, and add your local and deployed app domains to the authorized domains list.
2. Use the existing Firestore database named `ai-studio-e316c560-bff4-411c-9095-0c6d6acbe77f`, which is configured in `firebase-applet-config.json`. If changing projects, update the database ID consistently in `firebase.json`, `firebase-applet-config.json`, `functions/src/index.ts`, and `storage.rules`.
3. Ensure Firebase Storage is enabled for the configured bucket.
4. Select the Firebase project in the CLI:

   ```bash
   firebase login
   firebase use <your-firebase-project-id>
   ```

5. Set the Gemini key as a Firebase Functions secret (not a Vite environment variable):

   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   ```

6. Deploy Firestore and Storage rules and the callable function:

   ```bash
   firebase deploy --only firestore:rules,storage,functions
   ```

   The first Storage rules deployment may ask to enable Cloud Firestore access from Storage rules. Approve it so chat media can be restricted to conversation participants.

7. Configure Cloud Storage CORS so signed-in clients can download protected media through the Firebase SDK:

   ```bash
   gcloud storage buckets update gs://<your-storage-bucket> --cors-file=storage.cors.json
   ```

   Set the production web origin in `storage.cors.json` instead of the wildcard before deploying to production.

The checked-in `firebase-applet-config.json` is project-specific client configuration. For a different Firebase project, replace it with that project's web app configuration and update the Firestore database ID references above. Do not commit Firebase Admin service-account credentials.

## Environment variables

`.env.example` documents the server-only Gemini secret setup. The app does not read a Gemini key from Vite. Local Functions emulation should use the Firebase CLI's local secret support; production secrets are provisioned with `firebase functions:secrets:set`.

Optional public Firebase Cloud Messaging is not configured as a push-notification workflow. The app does not request browser notification permission on sign-in.

## Available commands

```bash
npm run dev                 # Vite development server
npm run lint                # TypeScript check
npm run build               # Production web build
npm run preview             # Preview the production build locally
npm run start               # Serve the built app
npm run test:rules            # Firestore security rules tests using the emulator
npm run build --prefix functions  # Compile Firebase Functions
```

`npm run test:rules` starts the Firestore emulator and checks participant-only chat access, message creation, sender-only edits/deletes, and protection against client-side membership changes. `npm run lint` and `npm run build` validate the client; `npm --prefix functions run build` validates the callable Functions code.

## Data and security notes

- Firestore rules restrict chats, messages, typing, whiteboard strokes, calls, and signaling data to authenticated participants. Message edits and deletions are limited to the sender.
- New chat attachments are stored as Storage object paths, not public download-token URLs. The client downloads them through Firebase Storage after authentication; Storage rules check membership in the configured named Firestore database.
- Existing messages that already contain Firebase download-token URLs remain readable for backwards compatibility. Those old URLs are bearer links; if one has been shared outside the conversation, rotate or remove that file's download token in Firebase Storage.
- On a user's next sign-in, the client moves legacy profile email and notification tokens into that user's private subcollection and removes them from the publicly discoverable profile document. Users who have not signed in since this change still need this migration.
- AI callable requests require Firebase authentication and are limited to 10 requests per minute and 100 per day per user. Chat message writes use Firebase Security Rules for membership and schema validation; application-level per-user message rate limiting is not yet implemented.
- User-invoked AI actions send the selected message text to Google's Gemini service for processing. Incoming messages are not automatically sent to Gemini for smart replies.
- This app does not implement end-to-end encryption. Firebase access controls protect data in transit and at rest as provided by the configured Firebase services.

## Deployment

Build and deploy the web app using your preferred static hosting provider:

```bash
npm ci
npm ci --prefix functions
npm run lint
npm run build
npm --prefix functions run build
firebase deploy --only firestore:rules,storage,functions
```

Configure the host to serve the generated `dist/` directory and rewrite application routes to `index.html`. Deploy the Firebase rules and Functions to the same project as the client configuration.
