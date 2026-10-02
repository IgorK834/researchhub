import { useInfiniteQuery } from '@tanstack/react-query';

import { queryKeys } from '../../../shared/api';
import { fetchConversations } from './conversationApi';

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
