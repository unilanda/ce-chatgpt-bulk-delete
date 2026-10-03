/** Design-time contracts for the existing vanilla-JS factories.
 * Runtime validation remains in the JS modules. No TypeScript build is required.
 */
export type ProviderId = string;
/** Produced/validated by ConversationRef, never by naive string concatenation. */
export type ConversationKey = string;
export interface ConversationRef { provider: ProviderId; providerConversationId: string; }
export type SourceTimestamp = number | string | null;
export type SHA256 = `sha256:${string}`;
export interface PayloadRef { store: string; key: string; }
export type CaptureScope = 'selected_branch' | 'whole_tree';
export interface Observation { updated_at_ms?: number | null; source_version?: string | null; }
export interface Freshness {
  state: 'never_saved' | 'current' | 'stale' | 'unknown';
  basis?: string;
  reason?: string;
}
export interface LocalOrganization {
  id: string; name: string; name_key: string; description: string;
  revision: number; created_at: number; updated_at: number; count?: number;
}
export interface Membership {
  key: string; conversation_ref: ConversationKey; added_at: number;
  collection_id?: string; tag_id?: string;
}
export interface OrganizationCreateOptions { description?: string; refs?: ConversationKey[]; }
export interface RevisionCheck { expectedRevision?: number; }
export interface MembershipOperations {
  addConversationRefs(id: string, refs: ConversationKey[]): Promise<number>;
  removeConversationRefs(id: string, refs: ConversationKey[]): Promise<number>;
  listConversationRefs(id: string): Promise<ConversationKey[]>;
  snapshot(): Promise<{ items: LocalOrganization[]; memberships: Membership[] }>;
}
export interface CollectionService extends MembershipOperations {
  createCollection(name: string, options?: OrganizationCreateOptions): Promise<LocalOrganization>;
  renameCollection(id: string, name: string, options?: RevisionCheck): Promise<LocalOrganization>;
  deleteCollection(id: string, options?: RevisionCheck): Promise<{ removed: number }>;
  listCollections(): Promise<LocalOrganization[]>;
  listCollectionIdsForConversation(ref: ConversationKey): Promise<string[]>;
}
export interface TagService extends MembershipOperations {
  createTag(name: string, options?: OrganizationCreateOptions): Promise<LocalOrganization>;
  renameTag(id: string, name: string, options?: RevisionCheck): Promise<LocalOrganization>;
  deleteTag(id: string, options?: RevisionCheck): Promise<{ removed: number }>;
  listTags(): Promise<LocalOrganization[]>;
  listTagIdsForConversation(ref: ConversationKey): Promise<string[]>;
}
export interface CaptureInput {
  conversation_ref: ConversationKey; capture_id: string;
  source_updated_at?: SourceTimestamp; source_version?: string | null;
  content_hash: string; normalized_hash: string; message_count: number;
  formats: Array<'md' | 'html' | 'txt' | 'json'>;
  payload_ref: PayloadRef; completeness: 'complete' | 'partial';
  scope: CaptureScope; branch_key: string;
  capture_version: string; normalizer_version: string; expected_revision?: number;
}
export interface ArchiveSnapshot {
  key: string; conversation_ref: ConversationKey; capture_id: string;
  revision: number; captured_at: number;
  source_updated_at_ms: number | null; source_version: string | null;
  content_hash: SHA256; normalized_hash: SHA256; message_count: number;
  formats: string[]; payload_ref: PayloadRef; payload_state: 'committed';
  completeness: 'complete' | 'partial'; scope: CaptureScope; branch_key: string;
  capture_version: string; normalizer_version: string;
}
export interface ArchiveHead {
  conversation_ref: ConversationKey; model_version: 2; revision: number;
  provider: string; provider_conversation_id: string;
  capture_state: 'captured' | 'never' | 'failed'; snapshot?: ArchiveSnapshot;
  invalidated?: boolean; updated_at: number;
  last_attempt: { state: 'captured' | 'failed'; at: number; error_code: string | null };
}
export interface ArchiveRegistry {
  recordCapture(input: CaptureInput): Promise<ArchiveHead>;
  get(ref: ConversationKey): Promise<ArchiveHead | undefined>;
  list(): Promise<ArchiveHead[]>;
  getRevision(ref: ConversationKey, revision: number): Promise<ArchiveSnapshot | undefined>;
  markFailed(ref: ConversationKey, code?: string): Promise<ArchiveHead>;
  markStale(ref: ConversationKey, sourceTime?: SourceTimestamp): Promise<ArchiveHead | null>;
  evaluateFreshness(ref: ConversationKey, sourceTime?: SourceTimestamp): Promise<Freshness['state']>;
}
export interface PinnedSource {
  conversation_ref: ConversationKey; revision: number;
  content_hash: SHA256; normalized_hash: SHA256;
  scope: CaptureScope; branch_key: string; normalizer_version: string;
}
export interface ArtifactSource extends PinnedSource { key: string; artifact_id: string; ordinal: number; }
export interface Artifact {
  id: string; type: string; title: string; status: 'draft' | 'ready';
  revision: number; producer: { id: string; version: string }; config_hash: SHA256;
  payload_ref: PayloadRef | null; created_at: number; updated_at: number;
}
export interface ArtifactService {
  create(input: { type: string; title: string; producer: { id: string; version: string };
    config_hash: string; sources: Array<{ conversation_ref: ConversationKey; revision: number }> }): Promise<Artifact>;
  commit(id: string, options: { payload_ref: PayloadRef; expectedRevision?: number }): Promise<Artifact>;
  get(id: string): Promise<Artifact | undefined>;
  list(): Promise<Artifact[]>;
  sources(id: string): Promise<ArtifactSource[]>;
  freshness(id: string, observations?: Record<ConversationKey, Observation>): Promise<{
    state: 'current' | 'stale' | 'unknown'; reasons: string[];
    basis?: string; remote_freshness_checked?: boolean;
  }>;
}
export interface ActionAvailability { enabled: boolean; code: string; reason: string; prerequisites?: readonly string[]; }
export interface PrerequisiteResult {
  kind: string; satisfied: boolean; missing_refs: ConversationKey[];
  stale_refs: ConversationKey[]; unknown_refs: ConversationKey[]; remedy: string | null;
}
export interface ActionContext {
  refs: ConversationKey[]; metadataReady?: boolean; activeDeleteJob?: boolean;
  archives?: Record<ConversationKey, ArchiveHead>;
  observations?: Record<ConversationKey, Observation>;
  classifications?: Record<ConversationKey, string>;
}
export interface ActionPlan {
  action_id: string; conversation_refs: readonly ConversationKey[];
  availability: ActionAvailability; stages: readonly string[];
  prerequisites: readonly string[]; requirements: PrerequisiteResult[];
}
export interface CaptureContext { ref: ConversationKey; tabId: number; signal: AbortSignal; capture_id: string; }
export interface CaptureProvider {
  conversationURL(ref: ConversationKey): string;
  matchesConversationURL(url: string, ref: ConversationKey): boolean;
  capture: null | {
    requiresFocus?: boolean;
    waitReady(context: CaptureContext): Promise<void>;
    capture(context: CaptureContext): Promise<Omit<CaptureInput, 'payload_ref'>>;
  };
}
export interface TabLease {
  token: string; tabId: number; windowId: number; ref: ConversationKey;
  owned: boolean; allowFocus: boolean; provider: CaptureProvider;
}
export interface TabRunner {
  acquire(options: { mode: 'current_tab' | 'managed_tab'; ref: ConversationKey;
    provider: CaptureProvider; tabId?: number; allowFocus?: boolean }): Promise<TabLease>;
  assertCurrent(lease: TabLease, options?: { requiresFocus?: boolean }): Promise<unknown>;
  release(lease: TabLease): Promise<{ closed: boolean; reason?: string }>;
}
export interface PayloadStore {
  persist(capture: Omit<CaptureInput, 'payload_ref'>,
    context: { capture_id: string; signal: AbortSignal }): Promise<{ durable: true; payload_ref: PayloadRef }>;
}
export interface CaptureRunResult {
  state: 'complete' | 'failed' | 'cancelled'; total: number; completed: number;
  items: Array<{ conversation_ref: ConversationKey; state: string; revision?: number; error_code?: string }>;
  durable_job_host: false; cleanup_warning?: string;
}
export interface CaptureOrchestrator {
  run(options: { refs: ConversationKey[]; mode?: 'current_tab' | 'managed_tab'; tabId?: number;
    allowFocus?: boolean; signal?: AbortSignal; onProgress?: (event: unknown) => void }): Promise<CaptureRunResult>;
}
