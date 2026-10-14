import { useId, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../shared/components/Button';
import { Dialog } from '../../shared/components/overlays/Dialog';
import { describeError } from '../../shared/api';
import { t, useLocale } from '../../shared/i18n';
import { MemberPicker } from '../comments/MemberPicker';
import {
  reviewTaskApi,
  transitions,
  type ReviewTarget,
  type ReviewTask,
  type TaskInput,
  type TaskStatus,
} from './reviewTaskApi';
import styles from './ReviewTasks.module.css';

export function TaskComposer({
  workspaceId,
  target,
  task,
  onSaved,
}: {
  readonly workspaceId: string;
  readonly target: ReviewTarget;
  readonly task?: ReviewTask;
  readonly onSaved: () => void;
}): ReactElement {
  useLocale();
  const id = useId(),
    client = useQueryClient();
  const attempt = useRef<string | null>(null);
  const [title, setTitle] = useState(task?.title ?? ''),
    [description, setDescription] = useState(task?.description ?? '');
  const [assignee, setAssignee] = useState<string | null>(task?.assignee ?? null),
    [assigneeLabel, setAssigneeLabel] = useState(task?.assigneeLabel ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'OPEN');
  const [due, setDue] = useState(task?.dueAt ? localDateTime(task.dueAt) : '');
  const mutation = useMutation({
    mutationFn: (input: TaskInput) => {
      if (task) return reviewTaskApi.update(workspaceId, task, input, status);
      attempt.current ??= crypto.randomUUID();
      return reviewTaskApi.create(workspaceId, attempt.current, target, input);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['review-tasks', workspaceId] });
      void client.invalidateQueries({ queryKey: ['notifications'] });
      onSaved();
    },
  });
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({
          title: title.trim(),
          description,
          assignee,
          dueAt: due ? new Date(due).toISOString() : null,
        });
      }}
    >
      <fieldset disabled={mutation.isPending}>
        <label htmlFor={`${id}-title`}>{t('collab.taskTitle')}</label>
        <input
          id={`${id}-title`}
          required
          maxLength={200}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            attempt.current = null;
          }}
        />
        <label htmlFor={`${id}-description`}>{t('collab.taskDescription')}</label>
        <textarea
          id={`${id}-description`}
          maxLength={4000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            attempt.current = null;
          }}
        />
        <p>
          {assignee
            ? `${t('collab.assignee')}: ${assigneeLabel}`
            : t('collab.unassigned')}
        </p>
        <MemberPicker
          workspaceId={workspaceId}
          label={t('collab.assignMember')}
          onSelect={(person) => {
            setAssignee(person.userId);
            setAssigneeLabel(person.displayLabel);
            attempt.current = null;
          }}
        />
        <Button
          variant="ghost"
          onClick={() => {
            setAssignee(null);
            setAssigneeLabel('');
            attempt.current = null;
          }}
        >
          {t('collab.unassign')}
        </Button>
        <label htmlFor={`${id}-due`}>{t('collab.due')}</label>
        <input
          id={`${id}-due`}
          type="datetime-local"
          value={due}
          onChange={(e) => {
            setDue(e.target.value);
            attempt.current = null;
          }}
        />
        {task ? (
          <label>
            {t('collab.taskStatus')}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {transitions(task.status).map((s) => (
                <option key={s} value={s}>
                  {t(`collab.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button type="submit" busy={mutation.isPending} disabled={!title.trim()}>
          {task ? t('common.save') : t('collab.createTask')}
        </Button>
      </fieldset>
      {mutation.error ? (
        <p role="alert">
          {describeError(mutation.error)}{' '}
          <Button
            onClick={() => {
              void client.invalidateQueries({ queryKey: ['review-tasks', workspaceId] });
            }}
          >
            {t('collab.reloadTasks')}
          </Button>
        </p>
      ) : null}
    </form>
  );
}
function localDateTime(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function CreateReviewTaskButton({
  workspaceId,
  target,
}: {
  readonly workspaceId: string;
  readonly target: ReviewTarget;
}): ReactElement {
  useLocale();
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={trigger} variant="ghost" size="compact" onClick={() => setOpen(true)}>
        {t('collab.requestReview')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={trigger}
        title={t('collab.createTask')}
      >
        {open ? (
          <TaskComposer
            workspaceId={workspaceId}
            target={target}
            onSaved={() => setOpen(false)}
          />
        ) : null}
      </Dialog>
    </>
  );
}
