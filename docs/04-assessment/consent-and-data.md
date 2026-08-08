# Assessment Consent and Data Requirements

Status: Draft
Version: 1.0
Launch Priority: Critical

---

# PURPOSE

This document defines the consent and privacy requirements for the AI Department Assessment.

---

# ASSESSMENT ENTRY

The user should be able to begin the assessment without facing a wall of legal text.

Use concise language linking to:

Privacy Policy

Terms of Use

---

# CONTACT CAPTURE

Before personalized results are displayed, the assessment may request:

- First name
- Last name
- Business email
- Phone
- Company
- Website

Potential supporting language:

"Enter your business information to receive your personalized AI Department Score and recommendations."

---

# REQUIRED CONSENT

Recommended required acknowledgment:

"By submitting this assessment, you agree that Your AI Department may process the information you provide to generate your assessment results and respond to your inquiry. See our Privacy Policy and Terms of Use."

Final legal wording should be reviewed before production.

Do not use a pre-checked checkbox.

---

# MARKETING EMAIL

Optional promotional email consent should be distinguishable from required assessment processing where appropriate.

Possible concept:

"I'd also like to receive AI growth insights, guides, and occasional updates."

Do not make optional marketing consent mandatory simply to receive assessment results unless intentionally reviewed and approved.

---

# SMS

Do not send promotional SMS merely because a phone number was submitted.

If promotional or automated marketing SMS is planned, include separate consent language appropriate to the actual messaging program.

Potential requirements may include:

- Clear disclosure
- Message frequency
- Message/data rates language where applicable
- STOP instructions
- HELP instructions
- Links to Terms
- Links to Privacy Policy

Final SMS language should be reviewed before use.

---

# STRATEGY CALL FOLLOW-UP

Submitting the assessment may permit reasonable follow-up relating to:

- Assessment results
- Requested consultation
- Requested services

Do not assume this creates unlimited promotional consent.

---

# INTERNAL DATA

Internal fields may include:

- Commercial Opportunity Score
- Opportunity flags
- Recommended services
- Lead priority
- Revenue range
- Employee count
- Advertising spend
- Urgency
- Buying authority

These are internal business records.

Do not expose the Commercial Opportunity Score to the user.

---

# ASSESSMENT RESULTS PRIVACY

Personalized result pages should not be publicly indexed.

Do not expose:

- Company assessment answers
- Contact information
- Internal qualification data

through guessable public URLs.

---

# RESULT URLS

Preferred approaches include:

- Session-based results
- Secure tokenized results
- Authenticated results
- Server-generated secure links

Do not create URLs such as:

/results/company-name/

that expose business information publicly.

---

# DATA MINIMIZATION

Only collect information required for:

- Assessment logic
- Recommendation logic
- ROI calculations
- Qualification
- Follow-up

Do not ask questions simply because the information might be interesting.

---

# SENSITIVE INFORMATION

The assessment should not request:

- Passwords
- Full financial account numbers
- Social Security numbers
- Protected medical data
- Confidential legal documents
- Sensitive customer records

---

# ROI DATA

Financial and labor inputs may use ranges rather than exact amounts where practical.

Examples:

Annual Revenue Range

Advertising Spend Range

Employee Count

Labor Cost Estimate

This reduces unnecessary data sensitivity while still supporting useful calculations.

---

# AI-GENERATED REPORTS

If AI is later used to generate personalized narrative reports:

- Scoring remains deterministic
- AI should receive only necessary data
- AI should not invent facts
- AI should not invent ROI
- AI should not modify the underlying score
- AI should explain established findings

---

# DATA RETENTION

Retention requirements should be defined before production launch.

Assessment data should not be retained indefinitely without a business reason.

---

# DELETION REQUESTS

The system architecture should make it reasonably possible to locate and delete user assessment data when required by applicable policy or law.

---

# SECURITY

Assessment submissions should use:

HTTPS

Server-side validation

Spam mitigation

Access controls

Secure storage

Server-side credentials

---

# DEVELOPMENT RULE

Do not ship the production assessment until:

- Privacy Policy exists
- Terms exist
- Consent language exists
- Data storage architecture is understood
- CRM destination is understood
- Email system is understood
- SMS behavior is understood
- Result privacy has been tested

