export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-muted mb-8">
          Last updated: April 11, 2026
        </p>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Overview
            </h2>
            <p>
              HO3 (&quot;the App&quot;) is a private personal finance application
              built exclusively for two authorized users: the account owner and
              their spouse. The App is not available to the general public and has
              no public registration. This policy describes how the App collects,
              uses, stores, and protects financial data.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Data We Collect
            </h2>
            <p>
              The App collects and processes the following categories of financial
              data to provide its budgeting, bill tracking, and debt management
              features:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Account information:</strong> account names, types,
                balances, and masked account numbers retrieved via Plaid.
              </li>
              <li>
                <strong>Transaction data:</strong> transaction amounts, dates,
                merchant names, and categories retrieved via Plaid.
              </li>
              <li>
                <strong>Liability data:</strong> credit card balances, APRs,
                minimum payments, due dates, student loan details, and mortgage
                information retrieved via Plaid&apos;s Liabilities product.
              </li>
              <li>
                <strong>User-entered data:</strong> bills, subscriptions,
                projected income, debt details, and priority settings entered
                manually by authorized users.
              </li>
              <li>
                <strong>Uploaded documents:</strong> receipt images and financial
                statement PDFs uploaded by authorized users for OCR processing.
              </li>
              <li>
                <strong>Authentication data:</strong> email addresses, hashed
                passwords, and TOTP multi-factor authentication credentials.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              How We Collect Data
            </h2>
            <p>
              Financial account data (transactions, balances, and liabilities) is
              collected through{" "}
              <a
                href="https://plaid.com/legal/#consumers"
                target="_blank"
                rel="noopener noreferrer"
                className="text-terracotta underline"
              >
                Plaid Inc.
              </a>
              , a licensed financial data aggregation service. By connecting a bank
              account through the App, users authorize Plaid to retrieve data from
              their financial institutions on the App&apos;s behalf. Plaid&apos;s own
              privacy policy governs how Plaid collects, uses, and protects data
              obtained from financial institutions.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              OCR Processing
            </h2>
            <p>
              When a user uploads a receipt image or financial statement, the
              document is sent to Anthropic&apos;s Claude API for optical character
              recognition (text extraction). Anthropic processes the image to
              extract structured data (merchant names, amounts, dates) and returns
              the results to the App. Uploaded images are transmitted to Anthropic
              solely for the purpose of text extraction and are subject to{" "}
              <a
                href="https://www.anthropic.com/policies/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-terracotta underline"
              >
                Anthropic&apos;s privacy policy
              </a>
              . Anthropic does not retain uploaded images from API requests for
              model training.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Data Storage &amp; Security
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                All data is stored in a Supabase-hosted PostgreSQL database with
                encryption at rest (AES-256).
              </li>
              <li>
                All data transmission between the App, Supabase, Plaid, and
                Anthropic occurs over TLS (HTTPS).
              </li>
              <li>
                Access to data is restricted by row-level security policies that
                enforce per-user, per-book access controls at the database level.
              </li>
              <li>
                All user logins require multi-factor authentication (TOTP via
                authenticator app) in addition to password authentication.
              </li>
              <li>
                Plaid access tokens are stored encrypted in the database and are
                never exposed to the client.
              </li>
              <li>
                Uploaded documents are stored in a private Supabase Storage bucket
                accessible only to authenticated users.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Data Sharing
            </h2>
            <p>
              We do <strong>not</strong> sell, share, rent, or transfer user
              financial data to any third parties for any purpose. Data is
              accessed only by the two authorized users of the App. The only
              third-party services that process data are:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Plaid Inc.</strong> — for retrieving financial account
                data from institutions, as authorized by the user.
              </li>
              <li>
                <strong>Anthropic (Claude API)</strong> — for OCR text extraction
                from user-uploaded receipt and statement images.
              </li>
              <li>
                <strong>Supabase</strong> — for database hosting and file storage.
              </li>
              <li>
                <strong>Vercel</strong> — for application hosting.
              </li>
            </ul>
            <p className="mt-2">
              None of these services receive data for advertising, marketing, or
              resale purposes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Analytics &amp; Tracking
            </h2>
            <p>
              The App uses <strong>no</strong> analytics services, tracking
              pixels, advertising networks, or third-party cookies. There is no
              behavioral tracking, no session recording, and no data collection
              beyond what is described in this policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Data Retention &amp; Deletion
            </h2>
            <p>
              Financial data is retained for as long as the App is in active use.
              Either authorized user may request complete deletion of all their
              data at any time by contacting the account owner at{" "}
              <a
                href="mailto:shaq@shaqhardy.com"
                className="text-terracotta underline"
              >
                shaq@shaqhardy.com
              </a>
              . Upon request, all user data — including transactions, account
              information, uploaded documents, and Plaid access tokens — will be
              permanently deleted from the database and storage within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground mb-2">
              Contact
            </h2>
            <p>
              For questions about this privacy policy or to request data deletion,
              contact{" "}
              <a
                href="mailto:shaq@shaqhardy.com"
                className="text-terracotta underline"
              >
                shaq@shaqhardy.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
