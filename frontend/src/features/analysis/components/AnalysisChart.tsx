import { useEffect, useRef, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../shared/components/Button';
import { AnalysisChartFrame } from './AnalysisWidgets';
import { describeError, queryKeys } from '../../../shared/api';
import { fetchChartImage, type Chart } from '../api/analysisApi';
import styles from './Analysis.module.css';

export function AnalysisChart({
  workspaceId,
  chart,
  onDetails,
}: {
  readonly workspaceId: string;
  readonly chart: Chart;
  readonly onDetails: () => void;
}): ReactElement {
  const image = useQuery({
    queryKey: [
      ...queryKeys.executionRecord(
        workspaceId,
        chart.sourceAnalysisId,
        chart.executionId,
      ),
      'image',
      chart.image.id,
    ],
    queryFn: ({ signal }) => fetchChartImage(workspaceId, chart, signal),
    gcTime: 0,
  });
  const element = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!image.data || !element.current) return;
    const target = element.current;
    const url = URL.createObjectURL(image.data);
    target.src = url;
    return () => {
      target.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [image.data]);
  const axis = (value: Chart['xAxis']): string =>
    value
      ? `${value.label}${value.unit ? ` (${value.unit})` : ''} · ${value.scale === 'LOG' ? 'log' : 'linear'}`
      : 'Not recorded';
  return (
    <AnalysisChartFrame
      title={chart.title}
      onDetails={onDetails}
      sourceFooter={`Analysis ${chart.sourceAnalysisId.slice(0, 8)} · Code SHA-256 ${chart.codeSha256.slice(0, 12)} · ${chart.image.mediaType === 'image/svg+xml' ? 'SVG' : 'PNG'}`}
    >
      {image.isPending ? <p role="status">Loading saved chart…</p> : null}
      {image.error ? (
        <p role="alert">
          Could not load chart: {describeError(image.error)}{' '}
          <Button
            variant="ghost"
            onClick={() => {
              void image.refetch();
            }}
          >
            Try again
          </Button>
        </p>
      ) : null}
      {image.data && !image.error ? (
        <img ref={element} alt={chart.title} className={styles.chartImage} />
      ) : null}
      <dl className={styles.axes}>
        <div>
          <dt>X axis</dt>
          <dd>{axis(chart.xAxis)}</dd>
        </div>
        <div>
          <dt>Y axis</dt>
          <dd>{axis(chart.yAxis)}</dd>
        </div>
      </dl>
      {!chart.metadataAvailable ? (
        <p className={styles.meta}>
          This earlier run did not record axis or series metadata. Its image and original
          execution record are preserved.
        </p>
      ) : null}
      {chart.series.length ? (
        <ul className={styles.series}>
          {chart.series.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong> · {s.pointCount} points from {s.tableName}:{' '}
              {s.xColumn} → {s.yColumn}
              {s.yTransform === 'ABS' ? ' (absolute value)' : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </AnalysisChartFrame>
  );
}
