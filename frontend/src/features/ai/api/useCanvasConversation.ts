import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/api';
import {
  startCanvasConversation,
  sendCanvasTurn,
  cancelCanvasTurn,
  type CanvasFirstTurn,
  type CanvasScope,
  type CanvasTurnRequest,
} from './conversationApi';
import { useConversationHistory } from './useConversations';

interface Attempt {
  readonly conversationId: string | null;
  readonly first: CanvasFirstTurn;
}
/** A saved reservation survives unmount. Retry reuses both identities and the entire payload. */
export function useCanvasConversation(
  workspaceId: string,
  initialConversationId: string | null = null,
) {
  const cache = useQueryClient();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const attempt = useRef<Attempt | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const identity = useRef(crypto.randomUUID());
  const inFlight = useRef(false);
  const history = useConversationHistory(workspaceId, conversationId);
  const pages = history.data?.pages ?? [];
  const messages = [...pages].reverse().flatMap((page) => page.messages);
  const turns = [...pages].reverse().flatMap((page) => page.turns ?? []);
  const lastTurn = pages[0]?.turns?.at(-1);
  const pending = turns.find(
    (turn) => turn.status === 'ACCEPTED' || turn.status === 'PLANNING',
  );
  const refresh = async (id: string): Promise<void> => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: queryKeys.aiConversations(workspaceId) }),
      cache.invalidateQueries({ queryKey: queryKeys.aiConversation(workspaceId, id) }),
    ]);
  };
  const run = async (input: Attempt): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    attempt.current = input;
    try {
      const state =
        input.conversationId === null
          ? await startCanvasConversation(workspaceId, input.first)
          : await sendCanvasTurn(workspaceId, input.conversationId, input.first.turn);
      setConversationId(state.conversationId);
      setRetryAvailable(false);
      await refresh(state.conversationId);
      return true;
    } catch (failure) {
      setError(failure);
      setRetryAvailable(true);
      return false;
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  return {
    conversationId,
    history,
    messages,
    turns,
    lastTurn,
    pending,
    submitting,
    error,
    retryAvailable,
    send: (
      contextId: string,
      instruction: string,
      scope: CanvasScope,
      replyToMessageId: string | null = null,
      targetProposalId: string | null = null,
    ) => {
      const turn: CanvasTurnRequest = {
        schemaVersion: '1.0',
        clientRequestId: crypto.randomUUID(),
        contextId,
        instruction,
        scope,
        intent: 'ANSWER',
        replyToMessageId,
        targetProposalId,
      };
      return run({
        conversationId,
        first: {
          schemaVersion: '1.0',
          clientConversationId: identity.current,
          contextId,
          turn,
        },
      });
    },
    retry: () =>
      attempt.current === null ? Promise.resolve(false) : run(attempt.current),
    cancel: async () => {
      if (conversationId === null || pending === undefined) return;
      try {
        await cancelCanvasTurn(workspaceId, conversationId, pending.turnId);
        await refresh(conversationId);
      } catch (failure) {
        setError(failure);
      }
    },
  };
}
