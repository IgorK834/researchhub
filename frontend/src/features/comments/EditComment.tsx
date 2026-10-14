import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { commentApi, type DocumentComment } from '../documents/comments/commentApi';
import { queryKeys, describeError } from '../../shared/api';
import { Button } from '../../shared/components/Button';
import { t, useLocale } from '../../shared/i18n';
import { MentionComposer } from './MentionComposer';
import { canonicalMentions } from './memberApi';
export function EditComment({
  comment,
}: {
  readonly comment: DocumentComment;
}): ReactElement {
  useLocale();
  const [editing, setEditing] = useState(false),
    [body, setBody] = useState(comment.body),
    [mentions, setMentions] = useState([...(comment.mentions ?? [])]);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      commentApi.edit(
        comment.workspaceId,
        comment.documentId,
        comment.id,
        comment.revision ?? 1,
        body,
        canonicalMentions(body, mentions),
      ),
    onSuccess: () => {
      setEditing(false);
      void client.invalidateQueries({
        queryKey: queryKeys.documentComments(comment.workspaceId, comment.documentId),
      });
    },
  });
  return (
    <>
      <Button
        variant="ghost"
        size="compact"
        onClick={() => {
          setEditing(!editing);
          setBody(comment.body);
          setMentions([...(comment.mentions ?? [])]);
          mutation.reset();
        }}
      >
        {t('collab.editComment')}
      </Button>
      {editing ? (
        <div>
          <MentionComposer
            workspaceId={comment.workspaceId}
            id={`edit-${comment.id}`}
            label={t('collab.editBody')}
            body={body}
            mentions={mentions}
            onChange={(value, typed) => {
              setBody(value);
              setMentions(typed);
            }}
            disabled={mutation.isPending}
            autoFocus
          />
          <Button
            disabled={!body.trim()}
            busy={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t('common.save')}
          </Button>
          {mutation.error ? <p role="alert">{describeError(mutation.error)}</p> : null}
        </div>
      ) : null}
    </>
  );
}
