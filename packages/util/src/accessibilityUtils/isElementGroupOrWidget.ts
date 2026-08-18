import type { QWElement } from '@qualweb/qw-element';
import { groupOrWidgetRoles } from './constants';

function isElementGroupOrWidget(element: QWElement): boolean {
  const role = window.AccessibilityUtils.getElementRole(element);
  return role !== null && groupOrWidgetRoles.includes(role);
}

export default isElementGroupOrWidget;
