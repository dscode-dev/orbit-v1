import type { OperationDetail } from "@erp/types";

/** Historical crew records stay readable but unavailable users are never preselected. */
export function activeAuxiliaryOperatorIds(assignments: NonNullable<OperationDetail["auxiliaryAssignments"]>): string[] {
  return assignments
    .filter((item) => item.status !== "CANCELED" && item.status !== "REJECTED"
      && item.assignee.isActive !== false && !item.assignee.disabledAt && !item.assignee.deletedAt
      && item.assignee.role !== "VIEWER")
    .map((item) => item.assignedTo);
}
