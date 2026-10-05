/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  AnalysisStatusChip,
  AnalysisPipeline,
  AnalysisCodePanel,
  AnalysisResultTable,
  AnalysisChartFrame,
  AnalysisFreshnessBanner,
  AnalysisListItem,
  type ComputationState,
  type PipelineStep,
  type ResultTableProps,
} from './AnalysisWidgets';
test.each<ComputationState>(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'])(
  'status %s has an icon and readable word',
  (state) => {
    const { container } = render(<AnalysisStatusChip state={state} />);
    expect(screen.getByText(state[0]! + state.slice(1).toLowerCase())).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  },
);
test('pipeline only displays the caller’s typed steps as inert text', () => {
  const steps: readonly PipelineStep[] = [
    {
      id: 'one',
      title: '<script>evil()</script>',
      description: 'Description',
      state: 'DONE',
    },
    {
      id: 'two',
      title: 'Compute',
      description: 'Working',
      state: 'IN_PROGRESS',
    },
    {
      id: 'three',
      title: 'Review',
      description: 'Upcoming',
      state: 'NEXT',
    },
  ];
  const { container } = render(<AnalysisPipeline steps={steps} />);
  expect(screen.getByText(steps[0]!.title)).toBeTruthy();
  for (const text of ['Done', 'In progress', 'Next'])
    expect(screen.getByText(text)).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
});
test('code is read-only, numbered, toggled, and never interpreted as HTML', () => {
  const { container } = render(
    <AnalysisCodePanel
      code={'<img src=x onerror=evil()>\nprint(19.5)\n'}
      hash={'a'.repeat(64)}
      footer={<span>Exact saved code</span>}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Show code',
    }),
  );
  expect(
    screen.getByRole('region', {
      name: 'Generated code, read-only',
    }),
  ).toBe(document.activeElement);
  expect(
    within(
      screen.getByRole('list', {
        name: 'Code with line numbers',
      }),
    ).getAllByRole('listitem'),
  ).toHaveLength(3);
  expect(screen.getByText('<img src=x onerror=evil()>')).toBeTruthy();
  expect(container.querySelector('img,input,textarea')).toBeNull();
  expect(screen.getByText('Exact saved code')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Hide code',
    }),
  );
  expect(screen.queryByText('print(19.5)')).toBeNull();
});
test('code panel supports controlled display without toggles or optional metadata', () => {
  const change = jest.fn();
  const view = render(<AnalysisCodePanel code="pass" open onOpenChange={change} />);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Hide code',
    }),
  );
  expect(change).toHaveBeenCalledWith(false);
  expect(screen.getByText('pass')).toBeTruthy();
  view.rerender(
    <AnalysisCodePanel code="pass" language="R" open toggleVisible={false} />,
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('The code that produced this · R, read-only')).toBeTruthy();
});
test('result table highlights only the explicit calculated column and paginates saved cells', () => {
  const fixture: ResultTableProps = {
    name: 'Measured and calculated',
    columns: ['Input', 'Calculated'],
    rows: Array.from(
      {
        length: 26,
      },
      (_, i) => [
        i,
        i === 0 ? null : i === 1 ? false : i === 2 ? '<script>evil</script>' : i * 2,
      ],
    ),
    calculatedColumn: 1,
  };
  const { container } = render(<AnalysisResultTable {...fixture} />);
  expect(
    screen
      .getByRole('columnheader', {
        name: 'Calculated (calculated)',
      })
      .getAttribute('data-calculated'),
  ).toBe('true');
  expect(screen.getByText('—')).toBeTruthy();
  expect(screen.getByText('false')).toBeTruthy();
  expect(screen.getByText('<script>evil</script>')).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Next rows',
    }),
  );
  expect(screen.getByText('26–26 of 26 rows')).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: 'Next rows',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Previous rows',
    }),
  );
  expect(screen.getByText('1–25 of 26 rows')).toBeTruthy();
});
test('empty table has no guessed calculation and cannot paginate', () => {
  render(<AnalysisResultTable name="Empty" columns={['Value']} rows={[]} />);
  expect(screen.getByText('0 of 0 rows')).toBeTruthy();
  expect(screen.getByRole('columnheader').getAttribute('data-calculated')).toBe('false');
  expect(
    (
      screen.getByRole('button', {
        name: 'Next rows',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
test('chart frame displays metadata and caller-owned content without plotting', () => {
  const details = jest.fn();
  const view = render(
    <AnalysisChartFrame
      title="Impedance"
      legend={['Measured', 'Fit']}
      caption="Exact saved plot"
      sourceFooter="data.csv · v1"
      onDetails={details}
    >
      <span>Chart content</span>
    </AnalysisChartFrame>,
  );
  expect(
    screen.getByRole('list', {
      name: 'Chart legend',
    }),
  ).toBeTruthy();
  expect(screen.getByText('data.csv · v1')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'View provenance',
    }),
  );
  expect(details).toHaveBeenCalledTimes(1);
  view.rerender(
    <AnalysisChartFrame title="Empty frame" sourceFooter="Saved execution">
      <span>Content</span>
    </AnalysisChartFrame>,
  );
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
test('freshness is supplied by the caller and updating is explicit', () => {
  const update = jest.fn();
  const view = render(
    <AnalysisFreshnessBanner outOfDate={false} message="Changed input" />,
  );
  expect(screen.queryByText('Out of date')).toBeNull();
  view.rerender(
    <AnalysisFreshnessBanner outOfDate message="Changed input" onUpdate={update} />,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Update reference',
    }),
  );
  expect(update).toHaveBeenCalledTimes(1);
  view.rerender(<AnalysisFreshnessBanner outOfDate message="Kept historical" />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Kept historical')).toBeTruthy();
});
test('list item displays typed metadata and delegates opening', () => {
  const open = jest.fn();
  render(
    <AnalysisListItem
      title="Mean resistance"
      state="COMPLETED"
      inputLabel="data.csv v1"
      timeLabel="Today"
      outputLabel="Table and chart"
      onOpen={open}
    />,
  );
  expect(screen.getByText('data.csv v1 · Today · Table and chart')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Open analysis',
    }),
  );
  expect(open).toHaveBeenCalledTimes(1);
});
test('table clamps pagination when a newly selected historical result has fewer rows', () => {
  const view = render(
    <AnalysisResultTable
      name="Old"
      columns={['Value', 'Calculated']}
      rows={Array.from({ length: 26 }, (_, i) => [i])}
    />,
  );
  expect(screen.getAllByText('—')).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Next rows' }));
  view.rerender(<AnalysisResultTable name="New" columns={['Value']} rows={[[19.5]]} />);
  expect(screen.getByText('19.5')).toBeTruthy();
  expect(screen.getByText('1–1 of 1 rows')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Previous rows' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
