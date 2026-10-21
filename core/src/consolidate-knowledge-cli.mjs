import { consolidateKnowledge } from './knowledge-consolidation.mjs';
consolidateKnowledge().then(results => console.log(JSON.stringify({ event: 'knowledge_consolidated', results }))).catch(error => {
  console.error(JSON.stringify({ event: 'knowledge_consolidation_failed', message: error.message }));
  process.exitCode = 1;
});
