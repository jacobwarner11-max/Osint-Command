# Court Records & Active Warrants — free-sources module

This is the eighth **module**, not an eighth executable OSINT tool. The current phase is an in-app guided directory that opens curated public sources in an external browser and supports local court research case notes. It does **not** automatically search every court, aggregate individual court records, run a background check, or certify warrant status.

## Product requirements (approved)
- Criminal and civil public case lookups, case numbers and histories, court dates, available public booking/arrest information, official public warrant listings, and freely available federal records.
- Begin with Texas and expand across jurisdictions; route researchers to official clerks, courts and law-enforcement sources.
- No required subscription, credits, paid API keys or paid document access; never trigger purchases. When a portal offers paid documents, skip them and label the record unavailable for free.
- Preserve link, issuing court/agency, jurisdiction, case number, record type, exact search/access date, last verification date, and explicit outcome/status when adding future evidence capture.
- Distinguish accusation, arrest, filed charge, pending proceeding, dismissal, acquittal and conviction. A person/name match alone is not verified identity.
- Never assert a warrant is active from a stale listing or absent because a public search returned no result; verify with the issuing agency.
- Respect source terms, access restrictions, sealed/expunged records, privacy and applicable law. No account bypass, bulk scraping or collection of nonpublic law-enforcement data.
- Free local report/export for all investigations, explicitly marking not searched / unavailable / unverified data.

## Present implementation
The Court Records navigation panel contains manually opened, curated links to: Nueces County District Clerk case-search entry point, Texas Judicial Directory, Nueces Sheriff Warrants/Civil Process contact, U.S. Marshals selected public fugitive profiles, and Free Law Project RECAP archive. It also permits creating a local court-research case with notes. **No search executes automatically.** Some upstream portals may offer optional paid services; do not purchase them.

## Next development steps
1. Expand jurisdiction directory with verified official county and state portal URLs and availability/access notes.
2. Add manually entered structured findings, status vocabulary, source URLs and retrieved timestamps, free document attachments, and export.
3. Add specific lawful/no-cost machine-readable provider integrations where officially offered; measure their coverage.
4. Build coverage and verification reports that clearly disclose unavailable records and non-real-time warrant information.

Reference pages checked 2026-09-26:
- https://www.txcourts.gov/about-texas-courts/frequently-asked-questions/
- https://www.nuecesco.com/courts/district-clerk/case-search
- https://www.nuecesco.com/law-enforcement/sheriff/directory
- https://www.usmarshals.gov/what-we-do/fugitive-apprehension/profiled-fugitives
- https://free.law/projects/courtlistener/
- https://pacer.uscourts.gov/pacer-pricing-how-fees-work (excluded due to potential charges)
