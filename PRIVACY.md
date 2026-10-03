# Privacy Policy

**ChatGPT Manager**

This Privacy Policy describes how your data is handled when you use the ChatGPT Manager Chrome extension.

## 1. Local Data Storage Only
This extension is designed to operate entirely locally on your device. We **do not** collect, transmit, store, or sell any of your personal data, chat history, or metadata on any external servers. 

All synchronization of your ChatGPT conversation history is performed directly between your browser and OpenAI's servers. Sanitized conversation metadata is saved strictly within your browser's local `IndexedDB` storage. One versioned DeleteJob may be stored in `chrome.storage.local`; it contains conversation IDs, approved classifications, state/count/timing fields, Project approval IDs, and sanitized outcome codes only. It does not duplicate titles, snippets, or messages. Search snippets, message bodies, raw search/detail responses, opaque cursors, and query-session IDs are not persisted. Eligibility verification may store only normalized classification evidence, HTTP status, request outcome, and generic schema warnings.

## 2. API Usage
The extension interacts with unsupported `https://chatgpt.com/backend-api/*` endpoints using your active, authenticated browser session. The dashboard temporarily reads the session access token into memory for discovery and verification reads. Choosing Delete may automatically perform sequential read-only detail checks for selected unverified search results before any deletion job exists. For each destructive step, the background service worker independently acquires the current session token in memory, sends at most one conversation deletion request, and discards the token. Tokens, cookies, Authorization values, and raw deletion responses are never stored in IndexedDB, job state, or extension messages. The read-only diagnostics store no response body and expose only aggregate or normalized schema facts. The one-conversation eligibility report omits the conversation ID, title, messages, snippets, and raw body.

## 3. Data Deletion
When you click **Clear local manager data** in the extension's dashboard, the local
conversation index and manager settings are removed from your browser. This action
does not delete any ChatGPT conversation.
When you approve and start a deletion job, the background service worker sends at most one deletion request per guarded execution step to ChatGPT. A durable alarm wakes every job; a requested target below 30 seconds may also use an in-memory timer, with both paths sharing the same duplicate-prevention guard. Verified Project conversations require an additional up-front approval and use the same conversation endpoint; their containing Projects are not deleted. A local record is removed only after a successful remote response. Network, HTTP, session, or eligibility failures preserve pending local records, pause the durable job, and require explicit review before any resume. There is no automatic destructive retry.

## 4. Analytics and Tracking
We do not include any third-party analytics, trackers, or telemetry within this extension.

## 5. Contact
If you have any questions or concerns about this privacy policy, please open an issue on the official GitHub repository.


## Manager metadata additions

This draft stores user-entered Collection/Tag names, memberships and canonical
provider conversation refs in a separate local IndexedDB. Archive and artifact
repositories may store revision/hash/scope/producer/payload references when a future
connected writer supplies them; this build does not retrieve or upload transcript
content for those features. No new server, analytics, AI endpoint or permission is
added. Cross-dashboard invalidation contains only a committed-change notification.

Clearing/rebuilding conversation inventory does not clear Collections, Tags or
archive/provenance metadata. Removing a local Collection/Tag does not delete source
conversations. Browser storage is not a portable backup; export/retention controls
and actual payload access will be specified with the Save integration.
