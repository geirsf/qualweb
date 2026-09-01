import type { QWElement } from '@qualweb/qw-element';
import { groupOrWidgetRoles } from './constants';
import getElementConcreteRole from './getElementConcreteRole';

function isElementGroupOrWidget(element: QWElement): boolean {
  const role = getElementConcreteRole(element);
  return role !== null && groupOrWidgetRoles.includes(role);
}

export default isElementGroupOrWidget;
