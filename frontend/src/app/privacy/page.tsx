import Link from "next/link";
import { LogoFull } from "@/components/ui/Logo";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-white">
      {/* Navbar */}
      <nav className="border-b border-white/[0.04] bg-navy-950/80 backdrop-blur-2xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center">
              <LogoFull size="sm" />
            </Link>
            <Link href="/" className="text-sm text-white/40 hover:text-white transition">
              Back to Home
            </Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-white/30 text-sm mb-10">Last updated: February 27, 2026</p>

        <div className="space-y-8 text-white/60 leading-relaxed text-[15px]">
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Introduction</h2>
            <p>
              SocyBase (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) operates the SocyBase platform.
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information
              when you use our service. Please read this policy carefully.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Information We Collect</h2>
            <p className="mb-3">We may collect the following types of information:</p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong className="text-white/80">Account Information:</strong> Email address, name, and password when you register.</li>
              <li><strong className="text-white/80">Facebook Data:</strong> When you connect your Facebook account, we access your ad accounts, pages, pixels, campaigns, ad sets, ads, and performance metrics via the Meta Marketing API. We only access data you explicitly authorize.</li>
              <li><strong className="text-white/80">Usage Data:</strong> Log data, device information, and how you interact with our platform.</li>
              <li><strong className="text-white/80">Payment Information:</strong> Processed securely through Stripe. We do not store your credit card details.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>To provide, operate, and maintain our platform.</li>
              <li>To sync and display your Facebook Ads performance data.</li>
              <li>To generate AI-powered campaign suggestions and insights.</li>
              <li>To process payments and manage your account.</li>
              <li>To communicate with you about service updates.</li>
              <li>To improve our platform and develop new features.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Facebook Data Usage</h2>
            <p className="mb-3">
              When you connect your Facebook account to SocyBase, we request the following permissions:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong className="text-white/80">ads_read:</strong> To read your ad account data and performance metrics.</li>
              <li><strong className="text-white/80">ads_management:</strong> To create and manage ad campaigns on your behalf.</li>
              <li><strong className="text-white/80">pages_read_engagement:</strong> To read engagement data from your Facebook pages.</li>
              <li><strong className="text-white/80">pages_show_list:</strong> To list your Facebook pages for selection.</li>
              <li><strong className="text-white/80">business_management:</strong> To access business-level ad account data.</li>
            </ul>
            <p className="mt-3">
              We store your Facebook access token in encrypted form. You can disconnect your Facebook account
              at any time, which will revoke our access and delete your stored token.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including:
              encrypted token storage (Fernet encryption), HTTPS for all communications,
              secure database connections with SSL, and access controls. However, no method of
              electronic transmission or storage is 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Data Sharing</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties.
              We may share data with:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li><strong className="text-white/80">Service Providers:</strong> Stripe for payments, OpenAI for AI features, and cloud hosting providers.</li>
              <li><strong className="text-white/80">Meta/Facebook:</strong> When publishing campaigns to your ad account (only with your explicit action).</li>
              <li><strong className="text-white/80">Legal Requirements:</strong> When required by law or to protect our rights.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active. When you delete your account
              or disconnect your Facebook account, we will delete the associated data within 30 days.
              Some data may be retained in backups for up to 90 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside space-y-2 ml-2 mt-3">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data.</li>
              <li>Disconnect your Facebook account at any time.</li>
              <li>Export your data.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Data Deletion</h2>
            <p>
              To request deletion of your data, you can disconnect your Facebook account from the
              FB Connection page, or contact us at the email below. We will process deletion requests
              within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any changes
              by posting the new policy on this page and updating the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">11. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at{" "}
              <a href="mailto:admin@socybase.com" className="text-blue-400 hover:text-blue-300 transition">
                admin@socybase.com
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.03] py-8 mt-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-white/20">
            &copy; {new Date().getFullYear()} SocyBase. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
