# Your AI Department — Page SEO & URL Standard

Status: Approved Planning Authority

## Principle

Every public page should have a deliberately defined search purpose before implementation.

File names, routes, page titles, headings, metadata, internal links, and page content should reinforce the same search intent without keyword stuffing.

## Required Page Definition

Before creating a new public page, document:

- primary search intent
- target audience
- canonical route
- URL slug
- SEO title
- meta description
- H1
- primary commercial destination
- secondary internal links
- CTA
- schema type where appropriate
- claim guardrails

## URLs

Use simple, descriptive, human-readable lowercase URLs.

Prefer:

/resources/where-should-a-business-start-with-ai/

/industries/manufacturing/

/industries/healthcare/

Avoid:

/resource?id=18472

/page-37/

/ai-business-ai-consulting-ai-help/

Do not keyword-stuff URLs.

## Resource File Names

When Astro content entries map to public slugs, use descriptive file names that closely match the intended canonical route.

Example:

src/content/resources/where-should-a-business-start-with-ai.md

Public route:

/resources/where-should-a-business-start-with-ai/

If the Astro architecture later uses an explicit slug field, the public slug remains the SEO authority rather than the physical source-file name.

## SEO Titles

Every page requires a unique, descriptive SEO title.

Titles should:

- accurately describe the page
- align with search intent
- differentiate the page from other site content
- avoid repetitive keyword stuffing
- include the Your AI Department brand where useful

Example:

Where Should a Business Start With AI? | Your AI Department

## Meta Descriptions

Every important indexable page requires a unique meta description.

Descriptions should:

- summarize the actual page
- communicate why the page is useful
- include relevant language naturally
- encourage a qualified visitor to click
- avoid unsupported claims
- avoid generic boilerplate repeated across pages

Search engines may generate a different snippet when another section of page content better matches the query.

## H1

Each page should normally have one clear primary H1 reflecting the page's subject.

The H1 does not need to be identical to the SEO title but should clearly reinforce the same intent.

## Internal Links

Use descriptive anchor text.

Resources should normally link to:

1. one primary commercial destination
2. closely related resources
3. one relevant next-step CTA

Commercial pages should link back to useful supporting resources when those resources help the buyer make a decision.

## Content Cannibalization

Do not publish multiple pages targeting substantially identical primary search intent without a clear strategic reason.

Before a new page is approved, compare it against:

- existing commercial pages
- industry pages
- resource pages
- planned resources

## Search Result Quality

Optimize pages for the user who sees them in a search result.

A page should make sense as a complete unit across:

URL
→ title
→ meta description
→ H1
→ introduction
→ body content
→ internal links
→ CTA

