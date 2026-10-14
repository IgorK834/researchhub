import { t as uiText, useLocale as useUiLocale } from '../../../shared/i18n';
import type { ReactElement } from 'react';
import { Panel } from '../../../shared/components/content';
import { RoleBadge } from '../../../shared/components/identity';
import styles from './WorkspaceViews.module.css';

export function RoleInformation(): ReactElement {
  useUiLocale();
  return (
    <Panel title={uiText('ui.RoleInformation.message001')}>
      <div className={styles.roleInfo}>
        <div>
          <RoleBadge role="OWNER" />
          <p>
            <strong>{uiText('ui.RoleInformation.message002')}</strong>
            <br />
            {uiText('ui.RoleInformation.message003')}
          </p>
        </div>
        <div>
          <RoleBadge role="EDITOR" />
          <p>
            <strong>{uiText('ui.RoleInformation.message004')}</strong>
            <br />
            {uiText('ui.RoleInformation.message005')}
          </p>
        </div>
        <div>
          <RoleBadge role="VIEWER" />
          <p>
            <strong>{uiText('ui.RoleInformation.message006')}</strong>
            <br />
            {uiText('ui.RoleInformation.message007')}
          </p>
        </div>
      </div>
    </Panel>
  );
}
