import type { ReactElement } from 'react';
import { AvatarStack } from '../../../shared/components/identity';
import type { Collaborator } from '../collaboration/presence';

export function DocumentPresence({
  people,
}: {
  readonly people: readonly Collaborator[];
}): ReactElement | null {
  return people.length < 2 ? null : (
    <AvatarStack
      people={people.map((person) => ({
        userId: person.userId,
        name: person.displayName,
      }))}
      label="In this document now"
      limit={3}
    />
  );
}
