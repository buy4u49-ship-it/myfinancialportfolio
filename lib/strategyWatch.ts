import { sendPushToUser } from "./push";
import { evaluateStrategy, normalizeStrategies } from "./strategies";
import type { StrategySnapshot, UserRecord } from "./types";

function utcNowIso() {
  return new Date().toISOString();
}

function sortedUnique(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value).trim().toUpperCase()).filter(Boolean))).sort();
}

function diffSymbols(previous: string[], next: string[]) {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    added: next.filter((symbol) => !previousSet.has(symbol)),
    removed: previous.filter((symbol) => !nextSet.has(symbol))
  };
}

export async function evaluateStrategyNotifications(record: UserRecord) {
  const allStrategies = normalizeStrategies(record);
  const strategies = allStrategies.filter((strategy) => strategy.active);
  const snapshots = Array.isArray(record.strategy_snapshots) ? record.strategy_snapshots : [];
  const nextSnapshots: StrategySnapshot[] = [...snapshots];
  const notifications: Array<{ strategyId: string; strategyName: string; added: string[]; removed: string[] }> = [];

  for (const strategy of strategies) {
    const evaluation = await evaluateStrategy(strategy);
    const nextSymbols = sortedUnique(evaluation.matches.map((match) => match.symbol));
    const previousSnapshot = nextSnapshots.find((snapshot) => snapshot.strategy_id === strategy.id);
    const previousSymbols = sortedUnique(previousSnapshot?.symbols || []);
    const changes = diffSymbols(previousSymbols, nextSymbols);

    strategy.last_evaluated_at = evaluation.evaluatedAt;
    strategy.last_match_count = nextSymbols.length;
    strategy.updated_at = strategy.updated_at || utcNowIso();

    if (previousSnapshot) {
      previousSnapshot.symbols = nextSymbols;
      previousSnapshot.updated_at = evaluation.evaluatedAt;
    } else {
      nextSnapshots.push({
        strategy_id: strategy.id,
        symbols: nextSymbols,
        updated_at: evaluation.evaluatedAt
      });
    }

    if (previousSnapshot && (changes.added.length || changes.removed.length)) {
      notifications.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        added: changes.added,
        removed: changes.removed
      });
      const addedText = changes.added.length ? `Added: ${changes.added.join(", ")}` : "";
      const removedText = changes.removed.length ? `Removed: ${changes.removed.join(", ")}` : "";
      await sendPushToUser(record, {
        title: "Strategy match changed",
        body: [strategy.name, addedText, removedText].filter(Boolean).join(" · "),
        data: {
          type: "strategy",
          strategyId: strategy.id
        }
      });
    }
  }

  record.strategies = allStrategies;
  record.strategy_snapshots = nextSnapshots;
  return notifications;
}
