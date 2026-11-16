# QuickBlox Integration & Architecture Audit

**Document Title:** Technical Audit: QuickBlox Native SDK vs. Queue Consultation  
**Project:** Body Inc Access Hub (`bodyinc-access-hub`)  
**Date:** November 2026  
**Status:** Completed & Verified  

---

## Executive Summary

This document provides a comprehensive technical audit and architectural breakdown of the communication subsystem in the **Body Inc Access Hub**. It directly addresses the five core architectural questions regarding **Queue Consultation (Q-Consultation)**, the **official QuickBlox SDK**, and direct **patient-doctor-admin communication flows**.

### Key Takeaways:
1. **Queue Consultation is NOT in use**: The application has completely transitioned away from QuickBlox's external Queue Consultation (Q-Consultation) service and iframe embed.
2. **Current SDK**: The client uses the **official QuickBlox JavaScript Web SDK version 2.24.0 (Build 1180)** located locally at `/quickblox.min.js`, complemented by native server-side **QuickBlox REST API (v0.1.1)** calls authenticated with HMAC-SHA1 signatures.
3. **No Third-Party Dependencies**: No external iframe or third-party queue server is required. WebRTC calling and XMPP chat run natively within our custom UI.
4. **Design Integrity**: The existing UI/UX, clinical dashboard, waiting room list, and patient charts remain 100% pixel-perfect and preserved.

---

## 1. Are We Currently Using Queue Consultation in Our Application?

### Technical Verdict: **NO**

The application is **no longer using QuickBlox Queue Consultation (Q-Consultation)**.

### Historical Implementation:
In earlier versions of the codebase (prior to commits `26ba9b8` and `8d592bf`), the application relied on QuickBlox's Q-Consultation backend:
* The server queried `/appointments`, `/appointments/my`, and `/auth/login` with `{ role: "provider" | "client" }`.
* The frontend embedded `https://provider.quickblox.com/appointment/{id}` inside an `<iframe>` or redirected providers to the external QuickBlox-hosted web app.

### Current Implementation:
* All `/appointments` and `/auth/login` calls have been replaced with direct calls to QuickBlox's native REST API (`/chat/Dialog.json`, `/session.json`, `/users.json`).
* The external iframe has been completely retired (`api.consultations.embed.ts` returns `HTTP 410 Gone`).
* Video/audio calls and chat messages are rendered inside our native, in-house React component: [`src/components/consultation/consultation-room-page.tsx`](file:///Users/apple/Documents/Manan/2026/Bodyinc/bodyinc-access-hub/src/components/consultation/consultation-room-page.tsx).

### Clarification Regarding the "Live Queue & Waiting Room" UI:
Inside `consultation-room-page.tsx`, there is a sidebar panel titled **"Live Queue & Waiting Room"**. 
* **This is NOT QuickBlox Queue Consultation.**
* It is a proprietary, in-house clinic UI panel that queries our PostgreSQL (Supabase) database and native QuickBlox Dialogs.
* It allows doctors and clinic administrators to see all active consultations in the clinic, view patient status, and switch between consultations seamlessly without leaving the page.

---

## 2. Which QuickBlox SDK Are We Currently Using?

We are using the **official QuickBlox JavaScript Web SDK version 2.24.0 (Build 1180)** along with the native **QuickBlox REST API (Version 0.1.1)**.

### Client-Side SDK Details:
* **File Location:** Hosted directly at [`public/quickblox.min.js`](file:///Users/apple/Documents/Manan/2026/Bodyinc/bodyinc-access-hub/public/quickblox.min.js) (zero external CDN dependency).
* **Global Instance:** Dynamically attached to `window.QB` and initialized via:
  ```typescript
  window.QB.init(
    roomData.quickblox.appId,
    roomData.quickblox.authKey,
    roomData.quickblox.authSecret,
    roomData.quickblox.accountKey
  );
  ```
* **WebRTC Calling Subsystem (`QB.webrtc`):**
  * Manages audio and video sessions directly via standard browser WebRTC APIs.
  * Methods used: `createNewSession`, `getUserMedia`, `session.call`, `session.accept`, `session.reject`, `session.stop`, `session.mute`, `session.unmute`.
  * Event listeners: `onCallListener`, `onRemoteStreamListener`, `onAcceptCallListener`, `onRejectCallListener`, `onStopCallListener`, `onUserNotAnswerListener`.
* **Chat Subsystem (`QB.chat`):**
  * Real-time XMPP-over-WebSocket messaging.
  * Methods used: `connect`, `muc.join`, `send`, `sendIsTypingStatus`, `sendIsStopTypingStatus`.
  * Event listeners: `onMessageListener`, `onMessageTypingListener`.
  * History retrieval: `QB.chat.message.list({ chat_dialog_id })`.
* **Content / Attachment Subsystem (`QB.content`):**
  * Secure file uploads for lab results and images via `createAndUpload` and `privateUrl`.

### Server-Side REST API Details:
* Located in [`src/lib/consultations/quickblox.ts`](file:///Users/apple/Documents/Manan/2026/Bodyinc/bodyinc-access-hub/src/lib/consultations/quickblox.ts).
* Authenticates directly with `https://api.quickblox.com/session.json` using SHA-1 HMAC request signatures generated from `QUICKBLOX_AUTH_SECRET`.
* Performs administrative tasks: registering users, provisioning provider agents, managing dialog participants, and listing dialogs.

---

## 3. Which SDK or Implementation Were We Using Before Integrating Queue Consultation?

Prior to integrating Queue Consultation, **there was no other SDK**.

* The initial consultation feature in this repository was originally built using **QuickBlox Q-Consultation REST endpoints and iframe embedding** (`provider.quickblox.com`).
* Because Q-Consultation introduced session sync failures, iframe cookie restrictions, and an unbranded external web UI, the project migrated away from Q-Consultation to the **native QuickBlox Client SDK (v2.24.0)**.
* There are no earlier legacy telephony or WebRTC SDKs (such as Twilio, Agora, or Vonage) in the git lineage.

---

## 4. How Can We Manage Patient, Doctor, and Admin Communication Directly Through the QuickBlox SDK Without Queue Consultation?

The direct communication architecture eliminates the middleman queue server by utilizing native **QuickBlox Group Dialogs (`type: 2`)** and peer-to-peer **WebRTC sessions**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        QuickBlox Direct Architecture                    │
└────────────────────────────────────────────────────────────────────────┘

  [ Patient ]                     [ Doctor / Provider ]          [ Clinic Admin ]
  (QB Client User)                (QB Provider User)             (QB Admin User)
         │                                 │                            │
         │  1. Authenticates               │  1. Authenticates          │  1. Authenticates
         │     via HMAC session            │     via provider session   │     via master creds
         │                                 │                            │
         └─────────────────────────┬───────┴────────────────────────────┘
                                   │
                                   ▼
                   [ QuickBlox Group Dialog (Type 2) ]
                   - Created natively via POST /chat/Dialog.json
                   - Occupants: [Patient ID, Doctor ID, Admin ID]
                   - Unique XMPP Room JID: appId_dialogId@muc.chat.quickblox.com
                                   │
         ┌─────────────────────────┴───────────────────────────┐
         │                                                     │
         ▼                                                     ▼
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│     XMPP Real-Time Chat         │           │      WebRTC Audio/Video Call     │
├─────────────────────────────────┤           ├─────────────────────────────────┤
│ • QB.chat.connect()             │           │ • QB.webrtc.createNewSession() │
│ • QB.chat.muc.join()            │           │ • session.getUserMedia()        │
│ • QB.chat.send()                │           │ • session.call()                │
│ • QB.chat.onMessageListener     │           │ • QB.webrtc.onCallListener      │
│ • QB.chat.message.list()        │           │ • session.accept() / reject()   │
│ • QB.chat.sendIsTypingStatus()  │           │ • onRemoteStreamListener        │
│ • QB.content.createAndUpload()  │           │ • session.mute() / unmute()     │
└─────────────────────────────────┘           └─────────────────────────────────┘
```

---

## 5. What Changes Were Required in the Codebase?

### Changes Completed:
1. **Removed Deprecated Environment Variable:**
   * Removed `QUICKBLOX_PROVIDER_APP_URL=https://provider.quickblox.com` from [`.env`](file:///Users/apple/Documents/Manan/2026/Bodyinc/bodyinc-access-hub/.env). This was an unused legacy URL leftover from the old Q-Consultation provider app.
2. **Fixed Consultation Room Call Error Copy:**
   * In [`consultation-room-page.tsx`](file:///Users/apple/Documents/Manan/2026/Bodyinc/bodyinc-access-hub/src/components/consultation/consultation-room-page.tsx#L915), removed the outdated message referring to the external Web App.
3. **Confirmed Server & Route Deprecation Stubs:**
   * Verified that `src/routes/api.consultations.embed.ts` returns `HTTP 410 Gone`.
   * Verified that `src/routes/appointment.$.ts` safely redirects legacy URLs to `/admin/consultations`.
4. **Verified UI/UX Preservation:**
   * The complete UI/UX remains identical: video call viewport, call controls, live chat pane, attachment uploader, clinical tabs.

---

## Verification & Build Results

* **TypeScript Compilation:** `npx tsc --noEmit` passed with 0 errors.
* **Production Build:** `npm run build` succeeded cleanly with full SSR bundle generation.

