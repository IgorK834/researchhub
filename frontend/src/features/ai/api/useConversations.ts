import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '../../../shared/api';
import { fetchConversations, fetchConversationHistory } from './conversationApi';

/** Shared cache shape for the editor's history and the workspace's recent-activity summary. */
export function useConversationsQuery(workspaceId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.aiConversations(workspaceId),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchConversations(workspaceId, pageParam, signal),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 0,
  });
}

/** Both views observe the same saved history; leaving the view never cancels a canvas turn. */
export function useConversationHistory(
  workspaceId: string,
  conversationId: string | null,
) {
  return useInfiniteQuery({
    queryKey: queryKeys.aiConversation(workspaceId, conversationId ?? ''),
    enabled: conversationId !== null,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      fetchConversationHistory(workspaceId, conversationId ?? '', pageParam, signal),
    getNextPageParam: (page) => page.nextBeforeSequence ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.error === null &&
      query.state.data?.pages.some((page) =>
        page.messages.some((message) => message.status === 'PENDING'),
      )
        ? 2000
        : false,
  });
}
