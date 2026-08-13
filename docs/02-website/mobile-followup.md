# Mobile QA Follow-Up

Status: Small Known Issue After Sprint 5

## Homepage Bottom CTA

The shared interior-page CTABand mobile issue was successfully fixed during Sprint 5.

A separate mobile CTA treatment remains on the homepage.

On narrow mobile widths, the homepage section:

"Ready to Find Your Biggest Opportunities?"

still displays a large bright cyan decorative shape behind the CTA text.

This reduces text contrast and recreates the visual problem that was removed from interior CTABand instances.

## Required Fix

Inspect the homepage-specific CTA component or styles.

At narrow mobile widths:

- preserve the dark CTA background
- preserve icon
- preserve white heading
- preserve supporting text
- preserve blue assessment button
- preserve small supporting text
- remove, hide, constrain, or reposition the large cyan decorative shape so it never sits beneath readable content

Preference:

Hide the large cyan decorative flourish throughout the homepage CTA's stacked/mobile layout if that is the cleanest solution.

## Protection

Do not:

- redesign the homepage
- change homepage copy
- change assessment CTA behavior
- alter assessment functionality
- alter desktop appearance unless necessary to fix an actual bug
- reopen the broader mobile design sprint

This is a small responsive bug fix only.

