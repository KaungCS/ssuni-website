# Legal pages: generator-sourced text, added near the end of development

A Privacy Policy is effectively mandatory (CalOPPA has no small-business floor, and Stripe's own merchant terms require one) and a Terms / Shipping & Returns policy is strongly recommended before real customers and real payments go live. We chose to source the actual policy text from a free policy generator (e.g. Termly, TermsFeed) rather than have it hand-drafted, and to defer generating it until near the end of development, once the real data practices (Supabase schema, Stripe integration, whether analytics ever get added) are finalized — a privacy policy has to accurately describe what the site actually does, and generating it early risked it being wrong by launch. The pages themselves (`/privacy`, `/terms`, `/shipping-returns`) are static, code-reviewed content, deliberately not editable through the Admin Dashboard, to prevent accidental or casual edits to legally load-bearing text.

## Consequences

The legal pages must not be forgotten as a late-stage task — they are a hard gate before the site can legitimately go live and start collecting real customer data.
