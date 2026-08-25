# Deploy to Cloudflare Pages/Workers instead of Vercel

The store needs to stay within free-tier hosting costs at launch, but Vercel's Hobby (free) plan terms prohibit commercial use — once Stripe goes live, compliant hosting there requires the $20/month Pro plan. Cloudflare Pages/Workers' free tier explicitly permits commercial use, includes SSL, DDoS protection, and a basic WAF at no cost, and its official OpenNext adapter (the path Next.js's own team now recommends) supports the App Router, SSR, ISR, and middleware this app needs. We chose Cloudflare over paying for Vercel Pro, switching before any deployment-specific code was written.

## Consequences

Watch the free tier's discouragement of serving a "disproportionate share" of images/large files as the product catalog and Hero Story count grow — may eventually require moving image hosting to a dedicated service (e.g. Cloudflare Images/R2).
