/* Compile-only public contract checks. Included in tsc, never executed or bundled. */
import { Button } from './Button';
import { Icon, SearchIcon, type IconName } from './icons';

export function validContracts() {
  return (
    <>
      <Button icon="plus" type="submit">
        Create
      </Button>
      <Button iconOnly icon="download" aria-label="Download source" />
      <Button href="/guide" variant="secondary">
        Read the guide
      </Button>
      <SearchIcon label="Search" size={14} />
      <Icon name="lineChart" size={20} />
    </>
  );
}

export function invalidContracts() {
  // @ts-expect-error Icon-only actions require an accessible name.
  const unnamed = <Button iconOnly icon="plus" />;
  // @ts-expect-error An icon-only action requires artwork.
  const missingIcon = <Button iconOnly aria-label="Create" />;
  const contradictory = (
    // @ts-expect-error Visible label and icon-only are mutually exclusive.
    <Button iconOnly icon="plus" aria-label="Create">
      Create
    </Button>
  );
  // @ts-expect-error Unknown design names must not reach the registry.
  const unknown = <Icon name="unknown" />;
  const linkSubmit = (
    // @ts-expect-error Link buttons cannot submit a form.
    <Button href="/guide" type="submit">
      Guide
    </Button>
  );
  // @ts-expect-error Registry names remain a literal union.
  const name: IconName = 'not-in-the-design';
  return { unnamed, missingIcon, contradictory, unknown, linkSubmit, name };
}
