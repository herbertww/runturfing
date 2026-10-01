/**
 * The evidence layer, in one place.
 *
 * The onboarding intro and the in-app research library read from this list, so
 * a claim can never say one thing on a slide and another on the reading page.
 * Every entry traces to docs/WALKING_SCIENCE.md — the guardrails there apply:
 * population-level findings, "roughly" figures, no medical promises, and no
 * claim to the rowers-high synchrony effect, which needs people moving in time
 * together and Runturfing is asynchronous.
 *
 * `url` is the primary source. It is live in the library and deliberately not
 * in the intro, where opening a browser mid-onboarding drops the runner out of
 * the flow and most never come back.
 */

export type ResearchTier = 'social' | 'physiology';

export interface ResearchFinding {
  key: string;
  tier: ResearchTier;
  /** Small caps line above the headline — the study's scale, not a label. */
  eyebrow: string;
  /** Large figure. Empty when the entry leads with an icon instead. */
  stat: string;
  statSuffix?: string;
  headline: string;
  /** Intro copy: one paragraph, no citation formatting. */
  body: string;
  /** Extra paragraph shown only in the library, where there is room for it. */
  detail?: string;
  /** Short citation, as printed. */
  source?: string;
  /** Primary source. Opened by the library; never by the intro. */
  url?: string;
  /** Caveat that must travel with the claim. */
  caveat?: string;
}

export const FINDINGS: ResearchFinding[] = [
  {
    key: 'pace',
    tier: 'social',
    eyebrow: 'MEASURED AT PARKRUN',
    stat: '12',
    statSuffix: 's faster',
    headline: 'You run faster with company',
    body:
      'Researchers timed parkrun regulars across repeated 5K runs. The ones who felt most part of the group came in up to 12 seconds quicker, and rated the effort no harder than usual.',
    detail:
      'The finding that matters is the second half. Feeling included did not just improve adherence, it improved the run itself, and the runners did not register the extra work. Social context made them quicker while it felt easier.',
    source: 'Davis et al., PLOS ONE 2021',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34525097/',
  },
  {
    key: 'team',
    tier: 'social',
    eyebrow: 'THE KÖHLER EFFECT',
    stat: '2×',
    statSuffix: ' as long',
    headline: 'A team keeps you going',
    body:
      "When the group score depends on your effort, you last about twice as long as you manage alone. A Runner's Inferno group is you and five other runners. Men can pay to guarantee a mixed group, and at the end of the season a bounty is split between the most active women.",
    detail:
      'The effect needs your effort to be indispensable to the team result, not merely visible to it. That is why the group is six people and why the season score is conjunctive: if your contribution could be absorbed by the others, the motivation gain disappears.',
    source: 'Irwin & Feltz, Ann Behav Med 2012',
    url: 'https://pubmed.ncbi.nlm.nih.gov/22576339/',
  },
  {
    key: 'spread',
    tier: 'social',
    eyebrow: '1.1 MILLION RUNNERS, 5 YEARS',
    stat: '0.3',
    statSuffix: ' km',
    headline: 'Your friends drag your distance up',
    body:
      'Every extra kilometre your friends ran on a given day added roughly 0.3 km to your own run that day. You drift toward whatever the people around you are doing.',
    detail:
      'Weather was used as a natural experiment to separate influence from people simply having similar habits. Less active runners influenced more active ones more than the reverse, which is why the app puts you with people at your level rather than with the fastest runners it can find.',
    source: 'Aral & Nicolaides, Nature Comms 2017',
    url: 'https://www.nature.com/articles/ncomms14753',
  },
  {
    key: 'groups',
    tier: 'social',
    eyebrow: '42 STUDIES, 1,843 PARTICIPANTS',
    stat: '↓',
    statSuffix: ' dropout',
    headline: 'Walking groups hold people',
    body:
      'A meta-analysis of organised walking groups found reductions in blood pressure, resting heart rate, body fat, cholesterol, BMI and depression risk, with few adverse effects and low dropout.',
    detail:
      'The adherence result is the one worth the entry fee. Plenty of interventions work while people do them; the group format is unusual in that people keep doing it.',
    source: 'Hanson & Jones, Br J Sports Med 2015',
    url: 'https://pubmed.ncbi.nlm.nih.gov/25601182/',
  },
  {
    key: 'brain',
    tier: 'physiology',
    eyebrow: 'RANDOMIZED CONTROLLED TRIAL',
    stat: '+2',
    statSuffix: '%',
    headline: 'Walking regrows the brain',
    body:
      'Sedentary adults walked 40 minutes, three times a week, for a year. Their hippocampus grew by about 2%, winding back one to two years of age-related shrinkage.',
    detail:
      'The stretching control group lost the 1 to 2% a year that is normally treated as simply ageing. Gains tracked with higher serum BDNF, the growth factor that supports neuron survival and new cell growth in the dentate gyrus.',
    source: 'Erickson et al., PNAS 2011',
    url: 'https://www.pnas.org/doi/10.1073/pnas.1015950108',
  },
  {
    key: 'gait',
    tier: 'physiology',
    eyebrow: '34,485 ADULTS OVER 65',
    stat: '0.1',
    statSuffix: ' m/s',
    headline: 'Walking speed predicts survival',
    body:
      'Every 0.1 m/s of walking pace tracked with better odds of survival. Age, sex and pace together forecast lifespan about as well as blood pressure, BMI and disease history do.',
    detail:
      'Pooled across nine cohorts and 17,528 deaths. Around 0.8 m/s is median survival, 1.0 m/s is better than median, and 1.2 m/s is exceptional. The signal gets stronger after 75.',
    source: 'Studenski et al., JAMA 2011',
    url: 'https://pubmed.ncbi.nlm.nih.gov/21205966/',
    caveat:
      'Population-level, non-clinical. It describes a group, not a prediction about any one person.',
  },
  {
    key: 'bone',
    tier: 'physiology',
    eyebrow: 'BONE LOSS IN SPACEFLIGHT',
    stat: '1–2',
    statSuffix: '% / month',
    headline: 'Bone needs to be loaded',
    body:
      'Astronauts lose one to two percent of bone mineral density a month in orbit, roughly ten times the monthly rate of postmenopausal osteoporosis on Earth. The cause is the absence of load, not age.',
    detail:
      'Bone remodels along the lines of stress it receives. Take the stress away, through spaceflight or prolonged bed rest, and it is resorbed faster than it is rebuilt. Weight-bearing movement is the signal that stops that.',
    source: 'npj Microgravity, 2020 (meta-analysis)',
    url: 'https://www.nature.com/articles/s41526-020-0103-2',
  },
  {
    key: 'pump',
    tier: 'physiology',
    eyebrow: 'THE SYSTEM WITH NO HEART',
    stat: '↑',
    statSuffix: ' clearance',
    headline: 'Muscle is the pump for everything that is not blood',
    body:
      'The heart moves blood. Lymph, the fluid that clears waste and carries immune cells out of your tissue, has no heart of its own. It moves when skeletal muscle squeezes the vessels running through it. Tracer injected into the thigh cleared faster during dynamic knee extensions than during an isometric hold, and faster than at rest.',
    detail:
      'Lymph vessels do contract on their own at roughly 1 to 15 cycles a minute, so nothing stalls outright when you sit still. Muscle contraction is the extrinsic pump on top of that, and the same squeeze is what drives venous blood back up the leg against gravity. "The calf is your second heart" is popular shorthand for that second half.',
    source: 'Havas et al., J Physiol 1997 · Havas & Lane, Sports Med 2005',
    url: 'https://pubmed.ncbi.nlm.nih.gov/9350633/',
    caveat:
      'Normal physiology in healthy limbs. Not a treatment claim for lymphoedema or venous disease.',
  },
  {
    key: 'endurance',
    tier: 'physiology',
    eyebrow: 'EVOLUTIONARY ANATOMY',
    stat: '2M',
    statSuffix: ' years',
    headline: 'The body is built for this',
    body:
      'A spring-like Achilles, an arched foot, a large gluteus maximus that fires in locomotion and goes quiet in standing, and millions of sweat glands that cool you while you keep moving. These are derived traits of genus Homo.',
    detail:
      'Bramble and Lieberman argue the suite is specialised for sustained endurance rather than speed, consistent with persistence hunting. Prey has to stop to pant. We do not.',
    source: 'Bramble & Lieberman, Nature 2004',
    url: 'https://www.nature.com/articles/nature03052',
  },
  {
    key: 'belonging',
    tier: 'social',
    eyebrow: '247 OLDER ADULTS, 6 MONTHS',
    stat: '↑',
    statSuffix: ' support',
    headline: 'Moving with others builds belonging',
    body:
      'Perceived social support rose while stress and loneliness fell. The increase in support predicted the drop in loneliness both directly and through the reduction in stress.',
    detail:
      'Group exercise classes show similar effects. Treat this as connectedness rather than a clinical result.',
    source: 'Aging Clin Exp Res, 2021',
    url: 'https://link.springer.com/article/10.1007/s40520-020-01722-w',
    caveat:
      'A systematic review rates the loneliness evidence low-certainty with small effects. Belonging, not a treatment.',
  },
  {
    key: 'bonding',
    tier: 'social',
    eyebrow: 'PAIN THRESHOLD AS ENDORPHIN PROXY',
    stat: '↑',
    statSuffix: ' threshold',
    headline: 'Effort itself does some of the bonding',
    body:
      'Rowers training synchronously as a crew showed higher pain thresholds than after equivalent solo work. A later dance study found synchrony and exertion each raise pain threshold and in-group bonding on their own.',
    detail:
      'Runturfing runs asynchronously, so it does not get the synchrony half of this. The defensible read is the dance result: exertion contributes independently, and the group identity supplies belonging without anyone having to move at the same time.',
    source: 'Cohen et al., Biol Lett 2010 · Tarr et al., Biol Lett 2015',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4650190/',
    caveat:
      'These measure pain threshold as a proxy. No endorphins were directly assayed, and the rowing effect needs literal synchrony.',
  },
];

/** The reading list, unabridged, for the library screen. */
export const SOURCES: Array<{ label: string; cite: string; url: string }> = [
  {
    label: 'Gait speed and survival',
    cite: 'Studenski et al., JAMA 2011',
    url: 'https://pubmed.ncbi.nlm.nih.gov/21205966/',
  },
  {
    label: 'Exercise, hippocampus and memory',
    cite: 'Erickson et al., PNAS 2011',
    url: 'https://www.pnas.org/doi/10.1073/pnas.1015950108',
  },
  {
    label: 'Endurance running and the evolution of Homo',
    cite: 'Bramble & Lieberman, Nature 2004',
    url: 'https://www.nature.com/articles/nature03052',
  },
  {
    label: 'Bone loss in space travellers',
    cite: 'npj Microgravity 2020',
    url: 'https://www.nature.com/articles/s41526-020-0103-2',
  },
  {
    label: 'The spring in the arch of the human foot',
    cite: 'Kelly et al., Sci Rep 2016',
    url: 'https://www.nature.com/articles/srep19403',
  },
  {
    label: 'Physiology, venous return (skeletal-muscle pump)',
    cite: 'StatPearls',
    url: 'https://www.ncbi.nlm.nih.gov/books/NBK538225/',
  },
  {
    label: 'Lymph flow in exercising human muscle',
    cite: 'Havas et al., J Physiol 1997',
    url: 'https://pubmed.ncbi.nlm.nih.gov/9350633/',
  },
  {
    label: 'Exercise and the lymphatic system',
    cite: 'Havas & Lane, Sports Med 2005 (review)',
    url: 'https://link.springer.com/article/10.2165/00007256-200535060-00001',
  },
  {
    label: 'The pump that moves everything except blood',
    cite: 'The Feynman Way (video explainer, not primary)',
    url: 'https://www.youtube.com/watch?v=tSVNb2Ummfw',
  },
  {
    label: 'Do walking groups have health benefits?',
    cite: 'Hanson & Jones, Br J Sports Med 2015',
    url: 'https://pubmed.ncbi.nlm.nih.gov/25601182/',
  },
  {
    label: 'The Köhler motivation gain effect',
    cite: 'Irwin, Feltz et al., Ann Behav Med 2012',
    url: 'https://pubmed.ncbi.nlm.nih.gov/22576339/',
  },
  {
    label: 'Exercise contagion in a global social network',
    cite: 'Aral & Nicolaides, Nat Commun 2017',
    url: 'https://www.nature.com/articles/ncomms14753',
  },
  {
    label: 'Social reward and performance at parkrun',
    cite: 'Davis, MacCarron & Cohen, PLOS ONE 2021',
    url: 'https://pubmed.ncbi.nlm.nih.gov/34525097/',
  },
  {
    label: 'Group activity, isolation and loneliness',
    cite: 'Aging Clin Exp Res 2021',
    url: 'https://link.springer.com/article/10.1007/s40520-020-01722-w',
  },
  {
    label: "Rowers' high: synchrony and pain thresholds",
    cite: 'Cohen, Dunbar et al., Biol Lett 2010',
    url: 'https://pubmed.ncbi.nlm.nih.gov/19755532/',
  },
  {
    label: 'Synchrony and exertion during dance',
    cite: 'Tarr et al., Biol Lett 2015',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4650190/',
  },
  {
    label: 'Better together: walking with friends',
    cite: 'Harvard Health (consumer media, not primary)',
    url: 'https://www.health.harvard.edu/staying-healthy/better-together-the-many-benefits-of-walking-with-friends',
  },
];

/** Findings the onboarding intro shows, in order. */
export const INTRO_KEYS = ['pace', 'team', 'spread', 'brain', 'gait'] as const;

export function findingByKey(key: string): ResearchFinding | undefined {
  return FINDINGS.find((f) => f.key === key);
}
