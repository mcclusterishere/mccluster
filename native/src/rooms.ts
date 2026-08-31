/**
 * The rooms, as content rather than as a promise of content.
 *
 * HERE, Equity Uprise and Prayer Closet previously rendered a shared shell
 * that told the visitor the content was "still on the web only" and offered a
 * button into Safari. Three of the five rooms on the bar were, functionally,
 * bookmarks — which is both a poor app and an automatic App Store rejection
 * under the minimum-functionality rule.
 *
 * Everything below is carried from the live pages: index.html,
 * equity-uprise.html and prayer-closet.html. Nothing here is invented. Where a
 * room genuinely has a deeper archive on the web — the Docket 516 filings, the
 * full memoranda — the room says so and links out as a footnote, not as its
 * reason for existing.
 */

export type Stat = { value: string; label: string };
export type Entry = { date?: string; title: string; body: string; meta?: string };
export type Section = { heading: string; blurb?: string; entries: Entry[] };

export type RoomContent = {
  kicker: string;
  title: string;
  lede: string;
  stats?: Stat[];
  sections: Section[];
  /** the page carrying the deeper archive, linked as a footnote */
  archive?: { label: string; page: string; note: string };
};

/* ------------------------------------------------------------------ HERE */

export const here: RoomContent = {
  kicker: 'Direction · Photo · Web · Music',
  title: 'McCluster\nCorp',
  lede: 'One person, the whole job. Matthew McCluster is a creative director, photographer, web designer and songwriter working out of Bridgeport, Connecticut and Acworth, Georgia.',
  stats: [
    { value: '5', label: 'government citations' },
    { value: '4', label: 'branches of work' },
    { value: '6', label: 'songs on the record' },
  ],
  sections: [
    {
      heading: 'The four branches',
      blurb: 'The work divides four ways, and every branch is on the record.',
      entries: [
        {
          title: 'Music',
          body: 'I AM HERE, a six-song album — Who Did The Shoot, Lightroom, Runway Walk, Write a Song, Here, Antisocial — plus the lyric films and the catalogue.',
          meta: 'Open the Music room',
        },
        {
          title: 'Media and photography',
          body: 'Commercial photography, the shot wall, the print shop and the production house.',
        },
        {
          title: 'Civic work',
          body: 'Equity Uprise: the public record, Docket 516, the policy archive and the fellowship platform.',
          meta: 'Open the Equity Uprise room',
        },
        {
          title: 'Studio and IT',
          body: 'Booking, client sites, the console, and the platform that runs them.',
        },
      ],
    },
    {
      heading: 'Identity of record',
      entries: [
        { title: 'ORCID', body: '0009-0000-8988-8955', meta: 'Researcher identity' },
        { title: 'ISNI', body: '0000 0005 2956 3111', meta: 'Name authority' },
        { title: 'McCluster Corp', body: 'Registered Connecticut public charity, CHR.0069693.', meta: 'Founded by Matthew McCluster' },
      ],
    },
  ],
  archive: {
    label: 'The full house on the web',
    page: 'index.html',
    note: 'The hero film, the timeline and the shot wall run on the site.',
  },
};

/* ---------------------------------------------------------- EQUITY UPRISE */

export const uprise: RoomContent = {
  kicker: 'A McCluster Corp program',
  title: 'Equity.\nThen we rise.',
  lede: 'A civic fellowship that works on the public record. Georgia to Connecticut, November 2024 to February 2026. Business development, workforce development, digital capacity building — no stock, no ownership, a time-limited revenue-share agreement.',
  stats: [
    { value: '$12.6M', label: 'the twenty-school Georgia pilot, costed line by line' },
    { value: '9', label: 'fellows in the 2025 cohort' },
    { value: '2', label: 'states where the work is on the public record' },
  ],
  sections: [
    {
      heading: 'Where the paper starts',
      blurb: 'Dated documents, in order. The first predates the fellowship\'s name and is here because the Georgia work starts with it.',
      entries: [
        {
          date: 'November 29, 2024',
          title: 'Opposition to legislation mandating DNA collection from misdemeanor offenders',
          body: 'Argued on four fronts: Fourth Amendment doctrine under Maryland v. King, the equity consequences for minority and low-income populations, the fiscal load of processing and storage, and the thin evidence that it reduces crime at all. Written alone, before any cohort.',
          meta: 'Addressed to Gov. Brian Kemp · sole author',
        },
        {
          date: '2025',
          title: 'Urban Leadership Fellowship, Atlanta',
          body: 'The founder applied to the Urban Leadership Fellowship\'s policy reform cohort and was selected. The memorandum above is how he got into the policy room.',
          meta: 'Atlanta, Georgia',
        },
        {
          date: '2025',
          title: 'The final policy presentation',
          body: 'The twenty-school Georgia pilot, costed line by line at $12.6M. Four names on the title slide: Senge Ngalame, Josh Thomas, Matthew McCluster, Brandon Isome.',
          meta: 'Policy reform cohort',
        },
        {
          date: 'February 2026',
          title: 'Docket 516',
          body: 'The Siting Council vote that denied the monopole plan. Every filing indexed, explained and linked to its official source.',
          meta: 'Connecticut',
        },
      ],
    },
    {
      heading: 'How it works',
      entries: [
        {
          title: 'A fellowship of fellowships',
          body: 'People say what they care about, and the platform points them at real programs and helps them apply.',
        },
        {
          title: 'The terms',
          body: 'No stock and no ownership. A time-limited revenue-share agreement, and the fellow keeps the business.',
        },
      ],
    },
  ],
  archive: {
    label: 'The filings and the full memoranda',
    page: 'equity-uprise.html',
    note: 'Each document opens the official source behind it.',
  },
};

/* ---------------------------------------------------------- PRAYER CLOSET */

export const closet: RoomContent = {
  kicker: 'Have no fear',
  title: 'Prayer\nCloset',
  lede: 'The room the house keeps for the work that isn\'t for sale. Limited pieces, real collaborators, and a story behind every garment.',
  sections: [
    {
      heading: 'Season 001: Matthew',
      blurb: 'The first season, and the rooms inside it.',
      entries: [
        {
          title: 'The Closet',
          body: 'Limited pieces in the season\'s drops. Each garment is cut from a chapter, and the chapter is named on the piece.',
        },
        {
          title: 'The Inner Room',
          body: 'Behind the garments there is a quieter room: the chapters each drop is cut from, a place to read, study, pray and keep your notes. No purchase opens it. It is open.',
        },
        {
          title: 'The Rack',
          body: 'Everyday wear, printed to order, so the season can keep moving forward.',
        },
      ],
    },
    {
      heading: 'Collaborations',
      blurb: 'The hands on the work.',
      entries: [
        {
          title: 'On the way',
          body: 'Not everything shows its face yet. Collaborators are announced as each drop is finished, never before.',
        },
      ],
    },
  ],
  archive: {
    label: 'The drops and the edition format',
    page: 'prayer-closet.html',
    note: 'Season 001 pieces and the collaborator list live on the site.',
  },
};
