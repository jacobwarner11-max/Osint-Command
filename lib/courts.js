'use strict';

// Curated, manually navigated public resources. These are not automated
// background-check databases. No paid services, tokens, scraping or credentials.
const COURT_SOURCES = Object.freeze([
  {
    id: 'nueces-district', name: 'Nueces County District Clerk — Case Search',
    scope: 'Texas / Nueces County', category: 'court',
    url: 'https://www.nuecesco.com/courts/district-clerk/case-search',
    details: 'Official county entry point for public district-court case searches. Some documents or linked services may carry separate fees: do not purchase them.'
  },
  {
    id: 'texas-directory', name: 'Texas Judicial Directory',
    scope: 'Texas statewide', category: 'court',
    url: 'https://www.txcourts.gov/judicial-directory/',
    details: 'Find the appropriate district, county, justice, municipal or appellate court and clerk. This directory is not a statewide case or warrant search.'
  },
  {
    id: 'nueces-warrants', name: 'Nueces County Sheriff — Warrants/Civil Process contact',
    scope: 'Texas / Nueces County', category: 'warrants',
    url: 'https://www.nuecesco.com/law-enforcement/sheriff/directory',
    details: 'Official contact directory for direct verification. Not an online list of all active warrants.'
  },
  {
    id: 'us-marshals', name: 'U.S. Marshals — Profiled Fugitives',
    scope: 'Federal / nationwide', category: 'warrants',
    url: 'https://www.usmarshals.gov/what-we-do/fugitive-apprehension/profiled-fugitives',
    details: 'Selected public fugitive profiles. Not a complete active-warrant database.'
  },
  {
    id: 'courtlistener', name: 'CourtListener / Free RECAP Archive',
    scope: 'Federal / nationwide', category: 'federal',
    url: 'https://www.courtlistener.com/recap/',
    details: 'Free public archive of available federal dockets and documents; coverage is not complete or real-time. Do not follow paid PACER access.'
  }
]);

const CATEGORIES = Object.freeze(['all', 'court', 'warrants', 'federal']);
function getCourtSources(category = 'all') {
  if (!CATEGORIES.includes(category)) throw new Error('Invalid court-source category.');
  return COURT_SOURCES.filter(source => category === 'all' || source.category === category).map(source => ({ ...source }));
}
function courtSourceUrl(id) {
  if (typeof id !== 'string') throw new Error('Unknown court source.');
  const source = COURT_SOURCES.find(item => item.id === id);
  if (!source) throw new Error('Unknown court source.');
  return source.url; // Only server-side curated HTTPS URLs; renderer cannot supply a URL.
}
module.exports = { getCourtSources, courtSourceUrl };
