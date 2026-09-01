import type { QWElement } from '@qualweb/qw-element';
import { widgetRoles } from './constants';
import getElementConcreteRole from './getElementConcreteRole';

function isElementWidget(element: QWElement): boolean {
  const role = getElementConcreteRole(element);
  return role !== null && widgetRoles.indexOf(role) >= 0;
}

export default isElementWidget;
