/**
 * Monthly challenges and lifetime achievements.
 */

export interface Challenge {
  id: number;
  month: string;
  type: string;
  description: string;
  targetValue: number;
  unit: string;
  completed: boolean;
  completedAt: string | null;
}

/** GET /challenges/current */
export interface ChallengeCurrentResponse {
  challenge: (Challenge & { currentValue: number }) | null;
  reason?: string;
}

/** GET /challenges/history */
export interface ChallengeHistoryResponse {
  challenges: Challenge[];
}

export interface Achievement {
  key: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt: string | null;
}

/** GET /achievements */
export interface AchievementsResponse {
  total: number;
  unlocked: number;
  achievements: Achievement[];
}
