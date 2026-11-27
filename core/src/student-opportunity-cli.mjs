import { observeOpportunities } from './student-opportunities.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live-read') {
  console.error('Usage: node core/src/student-opportunity-cli.mjs --live-read (GET only; no DB or notifications)');
  process.exitCode = 2;
} else {
  const result = await observeOpportunities();
  console.log(JSON.stringify(result, null, 2));
  if (result.state !== 'observed') process.exitCode = 1;
}
