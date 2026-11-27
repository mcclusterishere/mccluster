const CONFIGURATIONS = ['primary', 'strict_coverage', 'shift_8_cells', 'swap_sides'];
const LOG_WINDOW = [-Math.LN2, 0, Math.LN2]; // window length relative to 5.6 km
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const round = value => Number(value.toFixed(10));
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function heldOutFold(held, rows, scenario, coefficients) {
  const train = rows.filter(other =>
    Math.abs(held.weekMs - other.weekMs) > WEEK_MS &&
    (held.end < other.start || other.end < held.start));
  if (train.length < 6) throw new Error('Insufficient MOSAiC training coverage');
  const threshold = median(train.map(row => row.proxy));
  const high = held.proxy > threshold;
  const group = train.filter(row => (row.proxy > threshold) === high);
  if (!group.length) throw new Error('Missing MOSAiC training activity group');

  // Each training pair contributes the same three centered log window lengths.
  // Intercept and slope columns are orthogonal within each group. Thus OLS is
  // exactly the average of pair intercepts and/or slopes over the chosen rows.
  const levelRows = scenario === 'pooled' ? train : group;
  const slopeRows = scenario === 'group_slopes' ? group : train;
  const level = mean(levelRows.map(row => row.level));
  const slope = mean(slopeRows.map(row => row.slope));
  coefficients.push([held.week, threshold, level, slope]);
  const residual = LOG_WINDOW.map((x, i) => level + slope * x - held.logs[i]);

  return {
    week: held.week, n_train: train.length, high, threshold_per_day: threshold,
    log_mse: mean(residual.map(d => d * d)),
    shape_error: (Math.abs(residual[0] - residual[1]) + Math.abs(residual[2] - residual[1])) / 2,
  };
}

function refit(observations, name, scenario, coefficients) {
  const rows = observations.filter(row => !row.scenarios[name].excluded).map(row => {
    const observation = row.scenarios[name];
    const logs = observation.target_per_day.map(Math.log);
    return {
      week: row.week, weekMs: Date.parse(row.week), start: row.start, end: row.end,
      proxy: observation.proxy_per_day, logs, level: mean(logs),
      slope: (logs[2] - logs[0]) / (2 * Math.LN2),
    };
  });
  const folds = rows.map(row => heldOutFold(row, rows, scenario, coefficients));
  return {
    held_out_mse: round(mean(folds.map(fold => fold.log_mse))),
    median_shape_error: round(median(folds.map(fold => fold.shape_error))),
    folds: folds.map(fold => ({
      ...fold,
      threshold_per_day: round(fold.threshold_per_day),
      log_mse: round(fold.log_mse),
      shape_error: round(fold.shape_error),
    })),
  };
}

export function refitMosaic(observations, scenario) {
  const configurations = {};
  const coefficients = {};
  for (const name of CONFIGURATIONS) {
    coefficients[name] = [];
    configurations[name] = refit(observations, name, scenario, coefficients[name]);
  }
  return { configurations, coefficients };
}
