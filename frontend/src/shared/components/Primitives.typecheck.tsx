import { TextField, ChoiceCards } from './forms';
import { Badge, Avatar } from './identity';
import { Banner, Spinner, type ToastInput } from './feedback';
import { Dialog } from './overlays';

// Public contracts that tsc checks even though Babel intentionally erases types in component tests.
export const namedField = <TextField label="Email" type="email" />;
export const invalidField = (
  // @ts-expect-error Every field needs a visible label.
  <TextField />
);
export const invalidBadge = (
  // @ts-expect-error A badge needs both an icon and a word.
  <Badge tone="mint" icon="check" />
);
export const invalidAvatar = (
  // @ts-expect-error Photo avatars are outside this contract.
  <Avatar userId="a" name="Adam" src="/photo.png" />
);
export const invalidSpinner = (
  // @ts-expect-error A meaningful spinner needs a label or decorative=true.
  <Spinner />
);
export const invalidNote = (
  // @ts-expect-error A dashed explanatory note is non-interactive.
  <Banner tone="note" lead="Rules" action={<button>Retry</button>} />
);
export const invalidDialog = (
  // @ts-expect-error Dialogs need a title.
  <Dialog open onClose={() => {}}>
    Content
  </Dialog>
);
export const invalidChoices = (
  <ChoiceCards<'editor' | 'viewer'>
    label="Role"
    options={[{ value: 'editor', label: 'Editor' }]}
    // @ts-expect-error Explicit option value union rejects unknown selections.
    value="owner"
    onChange={() => {}}
  />
);
// @ts-expect-error A blocking toast must offer a named way forward.
export const invalidToast: ToastInput = {
  tone: 'blocking',
  title: 'Save failed',
  message: 'Your text is safe.',
};
