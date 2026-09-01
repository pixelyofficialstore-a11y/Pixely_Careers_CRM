export type CaseRole = "admin" | "support" | "designer";

export type CaseActivity = {
  activityType: string;
  actor?: unknown;
  previousValue?: string | null;
  newValue?: string | null;
  details?: Record<string, unknown> | null;
};

export function canAccessOrderCase(
  role: CaseRole,
  userId: number,
  assignedToId: number | null | undefined,
): boolean {
  return role !== "designer" || assignedToId === userId;
}

export function projectSuggestionForRole<T extends Record<string, unknown>>(
  suggestion: T,
  role: CaseRole,
): T {
  if (role === "admin") return { ...suggestion };
  const {
    adminNotes: _adminNotes,
    decisionNote: _decisionNote,
    adminNotesLog: _adminNotesLog,
    ...safeSuggestion
  } = suggestion;
  return safeSuggestion as T;
}
export function canAccessComplaintCase(
  role: CaseRole,
  userId: number,
  filedByUserId: number,
  complaintAgainstUserId: number | null | undefined,
  complaintTargetType: "designer" | "client" = "designer",
): boolean {
  if (role === "admin") return true;
  if (role === "support") return filedByUserId === userId;
  return filedByUserId === userId || (complaintTargetType === "designer" && complaintAgainstUserId === userId);
}

function isPrivateSuggestionActivity(activity: CaseActivity): boolean {
  if (activity.activityType !== "suggestion_updated") return false;
  const event = activity.details?.event;
  const fields = activity.details?.fields;
  return event === "admin_note_added"
    || (Array.isArray(fields) && fields.includes("adminNotes"));
}

export function projectCaseActivity<T extends CaseActivity>(
  activities: T[],
  role: CaseRole,
): T[] {
  return activities
    .filter(activity => role === "admin" || !isPrivateSuggestionActivity(activity))
    .map(activity => {
      if (role === "admin" || !activity.activityType.startsWith("complaint_")) {
        return { ...activity };
      }
      return {
        ...activity,
        actor: null,
        previousValue: activity.activityType === "complaint_note" ? null : activity.previousValue,
        newValue: activity.activityType === "complaint_note" ? null : activity.newValue,
      };
    }) as T[];
}
