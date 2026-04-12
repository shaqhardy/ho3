import { computeGoalProgress, type GoalLike, type LinkedAccount, type LinkedDebt, type ContributionLike } from "./compute";

interface GoalWithLinks {
  goal: GoalLike;
  linkedAccount?: LinkedAccount | null;
  linkedDebt?: LinkedDebt | null;
  contributions?: ContributionLike[];
}

export interface PlanGoalContext {
  behindGoals: Array<{
    id: string;
    name: string;
    percent: number;
    dailyPaceNeeded: number;
    targetDate: string | null;
  }>;
  onTrackGoals: Array<{
    id: string;
    name: string;
    percent: number;
  }>;
}

export function getGoalContextForPlan(
  items: GoalWithLinks[]
): PlanGoalContext {
  const behindGoals: PlanGoalContext["behindGoals"] = [];
  const onTrackGoals: PlanGoalContext["onTrackGoals"] = [];

  for (const { goal, linkedAccount, linkedDebt, contributions } of items) {
    if (goal.status !== "active") continue;
    const progress = computeGoalProgress(
      goal,
      linkedAccount,
      linkedDebt,
      contributions
    );
    if (progress.isCompleted) continue;
    if (progress.onTrack === false && progress.dailyPaceNeeded !== null) {
      behindGoals.push({
        id: goal.id,
        name: goal.name,
        percent: progress.percent,
        dailyPaceNeeded: progress.dailyPaceNeeded,
        targetDate: goal.target_date,
      });
    } else if (progress.onTrack === true || progress.onTrack === null) {
      onTrackGoals.push({
        id: goal.id,
        name: goal.name,
        percent: progress.percent,
      });
    }
  }

  return { behindGoals, onTrackGoals };
}
