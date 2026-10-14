import { formatNumber } from '../../../shared/i18n';
export function formatSourceBytes(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${formatNumber(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  if (bytes >= 1024)
    return `${formatNumber(bytes / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  return `${formatNumber(bytes)} B`;
}
