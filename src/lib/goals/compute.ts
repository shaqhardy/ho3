export interface GoalLike {
  id: string;
  name: string;
  type: "savings" | "debt_payoff" | "income" | "custom";
  target_amount: number | string;
  current_amount: number | string;
  target_date: string | null;
  linked_account_id: string | null;
  linked_debt_id: string | null;
  status: "active" | "completed" | "paused";
  created_at: string;
}

export interface LinkedAccount {
  id: string;
  current_balance: number | string;
}

export interface LinkedDebt {
  id: string;
  current_balance: number | string;
  original_balance: number | string | null;
}

export interface ContributionLike {
  amount: number | string;
  date: string;
}

export interface GoalProgress {
  current: number;
  target: number;
  percent: number;
  remaining: number;
  dailyPaceNeeded: number | null;
  projectedCompletion: Date | null;
  onTrack: boolean | null;
  isCompleted: boolean;
}

export function computeGoalProgress(
  goal: GoalLike,
  linkedAccount?: LinkedAccount | null,
  linkedDebt?: LinkedDebt | null,
  contributions?: ContributionLike[]
): GoalProgress {
  const target = Number(goal.target_amount);
  let current = 0;

  if (goal.type === "debt_payoff" && linkedDebt) {
    const orig = linkedDebt.original_balance
      ? Number(linkedDebt.original_balance)
      : target;
    const currDebt = Number(linkedDebt.current_balance);
    // Progress = amount paid off = original - current
    current = Math.max(0, orig - currDebt);
  } else if (goal.type === "savings" && linkedAccount) {
    current = Math.max(0, Number(linkedAccount.current_balance));
  } else if (contributions && contributions.length > 0) {
    current = contributions.reduce((sum, c) => sum + Number(c.amount), 0);
  } else {
    current = Number(goal.current_amount);
  }

  const remaining = Math.max(0, target - current);
  const percent = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const isCompleted = current >= target;

  let dailyPaceNeeded: number | null = null;
  let projectedCompletion: Date | null = null;
  let onTrack: boolean | null = null;

  if (goal.target_date && !isCompleted) {
    const targetDate = new Date(goal.target_date + "T00:00:00");
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const daysLeft = Math.max(
      1,
      Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    );
    dailyPaceNeeded = remaining / daysLeft;

    const startDate = new Date(goal.created_at);
    startDate.setHours(0, 0, 0, 0);
    const daysElapsed = Math.max(
      1,
      Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const totalDays = Math.max(
      1,
      Math.ceil(
        (targetDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      )
    );
    const expectedProgress = (daysElapsed / totalDays) * target;
    onTrack = current >= expectedProgress;

    const paceSoFar = daysElapsed > 0 ? current / daysElapsed : 0;
    if (paceSoFar > 0) {
      const daysToComplete = remaining / paceSoFar;
      projectedCompletion = new Date();
      projectedCompletion.setDate(
        projectedCompletion.getDate() + Math.ceil(daysToComplete)
      );
    }
  }

  return {
    current,
    target,
    percent,
    remaining,
    dailyPaceNeeded,
    projectedCompletion,
    onTrack,
    isCompleted,
  };
}
