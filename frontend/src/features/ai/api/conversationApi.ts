import {
  apiClient,
  requestEventStream,
  CSRF_PRIMING_PATH,
  ApiError,
  ApiTransportError,
  isKnownApiErrorCode,
  type ApiErrorCode,
  type ServerEvent,
} from '../../../shared/api';
import type { QuestionResponse } from './questionApi';
import type { AnalysisEvidenceReference } from './generationApi';

export interface Conversation {
  readonly id: string;
  readonly workspaceId: string;
  readonly createdBy: string | null;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly origin?: {
    readonly documentId: string;
    readonly contextId: string;
    readonly documentTitle: string;
  };
}
export interface ConversationPage {
  readonly items: readonly Conversation[];
  readonly nextOffset: number | null;
}
export interface ConversationMessage {
  readonly id: string;
  readonly clientRequestId: string;
  readonly sequence: number;
  readonly role: 'USER' | 'ASSISTANT';
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'ABANDONED';
  readonly authorId: string | null;
  readonly content: string;
  readonly selectedSourceIds: readonly string[] | null;
  readonly selectedAnalysisOutputs?: readonly AnalysisEvidenceReference[];
  readonly response: QuestionResponse | null;
  readonly errorCode: ApiErrorCode | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}
export interface ConversationHistory {
  readonly conversation: Conversation;
  readonly messages: readonly ConversationMessage[];
  readonly nextBeforeSequence: number | null;
  readonly turns?: readonly CanvasTurnState[];
}
export interface ConversationTurn {
  readonly user: ConversationMessage;
  readonly assistant: ConversationMessage;
}
export interface ConversationQuestion {
  readonly clientRequestId: string;
  readonly question: string;
  readonly selectedSourceIds?: readonly string[] | null;
  readonly selectedAnalysisOutputs?: readonly AnalysisEvidenceReference[];
}
export type ResearchEvent =
  | {
      readonly event: 'started';
      readonly data: {
        readonly conversationId: string;
        readonly user: ConversationMessage;
      };
    }
  | {
      readonly event: 'retrieval_completed';
      readonly data: { readonly chunkCount: number };
    }
  | { readonly event: 'delta'; readonly data: { readonly text: string } }
  | { readonly event: 'completed'; readonly data: ConversationTurn };

const path = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/ai/conversations`;
export async function createConversation(
  workspaceId: string,
  title: string,
  signal?: AbortSignal,
): Promise<Conversation> {
  const options = signal === undefined ? {} : { signal };
  await apiClient.get<void>(CSRF_PRIMING_PATH, options);
  return apiClient.post<Conversation>(path(workspaceId), { body: { title }, ...options });
}
export function fetchConversations(
  workspaceId: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<ConversationPage> {
  return apiClient.get<ConversationPage>(
    `${path(workspaceId)}?offset=${String(offset)}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}
export function fetchConversationHistory(
  workspaceId: string,
  conversationId: string,
  beforeSequence: number | null = null,
  signal?: AbortSignal,
): Promise<ConversationHistory> {
  return apiClient.get<ConversationHistory>(
    `${path(workspaceId)}/${encodeURIComponent(conversationId)}${beforeSequence === null ? '' : `?beforeSequence=${String(beforeSequence)}`}`,
    { ...(signal === undefined ? {} : { signal }) },
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
function message(value: unknown, role: string): value is ConversationMessage {
  return (
    object(value) &&
    value.role === role &&
    typeof value.id === 'string' &&
    typeof value.clientRequestId === 'string' &&
    typeof value.content === 'string' &&
    typeof value.sequence === 'number'
  );
}
function decode(event: ServerEvent): ResearchEvent {
  const data = event.data;
  if (!object(data))
    throw new ApiTransportError('The research event has an invalid payload');
  switch (event.event) {
    case 'started':
      if (typeof data.conversationId === 'string' && message(data.user, 'USER'))
        return {
          event: 'started',
          data: { conversationId: data.conversationId, user: data.user },
        };
      break;
    case 'retrieval_completed':
      if (
        typeof data.chunkCount === 'number' &&
        Number.isInteger(data.chunkCount) &&
        data.chunkCount >= 0 &&
        data.chunkCount <= 12
      )
        return { event: 'retrieval_completed', data: { chunkCount: data.chunkCount } };
      break;
    case 'delta':
      if (typeof data.text === 'string' && data.text.length <= 1000)
        return { event: 'delta', data: { text: data.text } };
      break;
    case 'completed':
      if (
        message(data.user, 'USER') &&
        message(data.assistant, 'ASSISTANT') &&
        data.assistant.status === 'COMPLETED' &&
        object(data.assistant.response) &&
        data.assistant.response.answer === data.assistant.content
      )
        return {
          event: 'completed',
          data: { user: data.user, assistant: data.assistant },
        };
      break;
    case 'error':
      if (
        typeof data.code === 'string' &&
        isKnownApiErrorCode(data.code) &&
        typeof data.detail === 'string' &&
        typeof data.retryable === 'boolean'
      )
        throw new ApiError({
          type: 'about:blank',
          title: 'Research request failed',
          status: data.retryable ? 503 : 400,
          code: data.code,
          rawCode: data.code,
          detail: data.detail,
        });
      break;
  }
  throw new ApiTransportError('The server returned an invalid research event');
}
export async function streamConversationQuestion(
  workspaceId: string,
  conversationId: string,
  question: ConversationQuestion,
  onEvent: (event: ResearchEvent) => void,
  signal: AbortSignal,
): Promise<ConversationTurn> {
  await apiClient.get<void>(CSRF_PRIMING_PATH, { signal });
  let completion: ConversationTurn | undefined;
  await requestEventStream(
    `${path(workspaceId)}/${encodeURIComponent(conversationId)}/messages/stream`,
    { body: question, signal },
    (raw) => {
      const event = decode(raw);
      onEvent(event);
      if (event.event === 'completed') {
        completion = event.data;
        return false;
      }
      return true;
    },
  );
  if (completion === undefined)
    throw new ApiTransportError(
      'The research stream ended before completion. Reload history before retrying.',
    );
  return completion;
}

/** Typed canvas requests have durable server status and do not depend on an open stream. */
export interface CanvasScope {
  readonly sourceVersionIds: readonly string[];
  readonly analysisOutputs: readonly AnalysisEvidenceReference[];
}
export interface CanvasTurnRequest {
  readonly schemaVersion: '1.0';
  readonly clientRequestId: string;
  readonly contextId: string;
  readonly intent: 'ANSWER' | 'EDIT' | 'ANALYZE' | 'SOLVE' | 'CLARIFY';
  readonly instruction: string;
  readonly replyToMessageId: string | null;
  readonly targetProposalId: string | null;
  readonly scope: CanvasScope;
}
export interface CanvasFirstTurn {
  readonly schemaVersion: '1.0';
  readonly clientConversationId: string;
  readonly contextId: string;
  readonly turn: CanvasTurnRequest;
}
export interface CanvasTurnState {
  readonly schemaVersion: '1.0';
  readonly turnId: string;
  readonly conversationId: string;
  readonly contextId: string;
  readonly intent: CanvasTurnRequest['intent'];
  readonly scope: CanvasScope;
  readonly status:
    'ACCEPTED' | 'PLANNING' | 'WAITING_FOR_INPUT' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly messageId: string | null;
  readonly proposalId: string | null;
  readonly executionId: string | null;
  readonly failureCode: ApiErrorCode | null;
  readonly resultKind: 'ANSWER' | 'CLARIFICATION' | null;
  readonly memory: {
    readonly includedMessages: number;
    readonly omittedMessages: number;
    readonly memoryHash: string;
  } | null;
}
export async function startCanvasConversation(
  workspaceId: string,
  body: CanvasFirstTurn,
): Promise<CanvasTurnState> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<CanvasTurnState>(`${path(workspaceId)}/contextual`, { body });
}
export async function sendCanvasTurn(
  workspaceId: string,
  conversationId: string,
  body: CanvasTurnRequest,
): Promise<CanvasTurnState> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<CanvasTurnState>(
    `${path(workspaceId)}/${encodeURIComponent(conversationId)}/turns`,
    { body },
  );
}
export async function cancelCanvasTurn(
  workspaceId: string,
  conversationId: string,
  turnId: string,
): Promise<CanvasTurnState> {
  await apiClient.get<void>(CSRF_PRIMING_PATH);
  return apiClient.post<CanvasTurnState>(
    `${path(workspaceId)}/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/cancel`,
    { body: {} },
  );
}
export function fetchCanvasTurn(
  workspaceId: string,
  conversationId: string,
  turnId: string,
  signal?: AbortSignal,
): Promise<CanvasTurnState> {
  return apiClient.get<CanvasTurnState>(
    `${path(workspaceId)}/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}`,
    signal === undefined ? {} : { signal },
  );
}
