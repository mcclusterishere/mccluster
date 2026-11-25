/* Offline composer for tests and --fixture runs. Hand written letters for the synthetic people only.
   Dana's first attempt deliberately breaks the dash rule so the retry path is exercised. */
const LETTERS = {
  'Dana Whitfield': [
    { subject: 'Eleven companies and a reserve', body: 'Ms. Whitfield,\n\nFund III backing only eleven companies \u2014 that line stopped me.\n\nMatthew McCluster' },
    { subject: 'Eleven companies, and the reserve for restarts', body: 'Ms. Whitfield,\n\nYour March note on Larkspur Fund III says the fund will back only eleven companies and hold money back for founders who have to restart after the first product fails. I had never seen a fund put the restart in writing before the first check.\n\nI am a computer science student at Southern Connecticut State University, and I am building a job and agent platform on my own. My first version already failed once, which is why that reserve caught my eye.\n\nWould you be open to a short conversation this winter about how you decide a founder deserves the second try?\n\nMatthew McCluster' },
  ],
  'Marcus Oyelaran': [
    { subject: 'The phone calls nobody records', body: 'Mr. Oyelaran,\n\nIn your January piece you said that after the Tidewell sale you spent a year riding along with regional dispatch desks, and that most freight decisions still happen on phone calls nobody records. That is a strange thing to learn after nine years of building the software meant to replace those calls.\n\nWhat did the ride alongs show you that nine years of Tidewell customer data never did?\n\nMatthew McCluster' },
  ],
  'Priya Castellanos': [
    { subject: 'Forty technicians a year in New Haven', body: 'Ms. Castellanos,\n\nI read that Northbeam Robotics will train forty warehouse technicians a year in New Haven through a paid apprenticeship with community colleges. I am Matthew McCluster, a founder in Connecticut who builds job software for exactly the kind of people that program will reach.\n\nOne small ask: could you point me to the person at Northbeam who runs the apprenticeship intake, so I can learn how candidates find it?\n\nThank you,\nMatthew McCluster' },
  ],
  'Jordan Pike': [
    { subject: 'Your open office for first time founders', body: 'Jordan,\n\nYou wrote in February that since selling Pike Tools you have been mentoring three student teams at Gateway Community College and holding a monthly open office for first time founders. I run a small company in Connecticut and I am one of those first time founders.\n\nCould I come to one of the open office sessions this winter, or would you introduce me to one of the Gateway teams working on scheduling tools?\n\nMatthew McCluster' },
  ],
};
export async function fixtureComposer({ person, attempt }) {
  const list = LETTERS[person.name];
  if (!list) return null;
  return list[Math.min(attempt, list.length) - 1];
}
