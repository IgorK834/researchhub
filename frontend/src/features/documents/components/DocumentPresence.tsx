import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { AvatarStack } from '../../../shared/components/identity';
import type { Collaborator } from '../collaboration/presence';

export function DocumentPresence({
  people,
}: {
  readonly people: readonly Collaborator[];
}): ReactElement | null {
  useUiLocale();
  return people.length < 2 ? null : (
    <AvatarStack
      people={people.map((person) => ({
        userId: person.userId,
        name: person.displayName,
      }))}
      label={uiText('ui.DocumentPresence.message001')}
      limit={3}
    />
  );
}
