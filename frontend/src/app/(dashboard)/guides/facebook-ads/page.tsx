"use client";

export default function FacebookAdsGuidePage() {
  const steps = [
    {
      number: 1,
      title: "Export Your Data",
      description:
        'Go to your completed job and click the "Export for FB Ads Manager" button. This generates a CSV file formatted specifically for Facebook\'s Custom Audience upload format.',
      tip: "The export automatically maps your data fields: First Name -> fn, Last Name -> ln, Birthday -> dob, Gender -> gender, Location -> ct",
    },
    {
      number: 2,
      title: "Open Facebook Ads Manager",
      description:
        "Navigate to Facebook Ads Manager (business.facebook.com/adsmanager). Click on the hamburger menu and select \"Audiences\" under \"All Tools\".",
      tip: "Make sure you have admin access to the ad account you want to use.",
    },
    {
      number: 3,
      title: "Create Custom Audience",
      description:
        'Click "Create Audience" -> "Custom Audience" -> "Customer List". Select "Upload a customer list" and click Next.',
      tip: 'If prompted, select "No" for including customer value - we\'re importing for targeting, not LTV tracking.',
    },
    {
      number: 4,
      title: "Upload Your CSV",
      description:
        "Upload the CSV file exported from SocyBase. Facebook will automatically try to map the columns. Verify the mapping: fn (First Name), ln (Last Name), ct (City), dob (Date of Birth), gender (Gender).",
      tip: "The more fields matched, the higher your audience match rate will be. Names and locations significantly improve matching.",
    },
    {
      number: 5,
      title: "Create Lookalike Audience",
      description:
        'Once your Custom Audience is created, go to "Audiences" -> "Create Audience" -> "Lookalike Audience". Select your Custom Audience as the source. Choose your target country and audience size (1-10%).',
      tip: "Start with 1% for the most similar audience. Expand to 3-5% for broader reach. Larger percentages give more reach but less precision.",
    },
    {
      number: 6,
      title: "Launch Your Campaign",
      description:
        "Create a new ad campaign. In the Ad Set level, under Audience, click \"Custom Audiences\" and select your Custom Audience or Lookalike Audience. Set your budget, schedule, and placements, then launch!",
      tip: "Pro tip: A/B test between your Custom Audience (retargeting) and Lookalike Audience (prospecting) to see which performs better.",
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1877F2]/10 border border-[#1877F2]/30 mb-4">
          <span className="text-[#1877F2] font-medium text-sm">Facebook Ads Manager</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Import Guide</h1>
        <p className="text-white/50 mt-2 max-w-xl mx-auto">
          Step-by-step guide to import your SocyBase exported data into Facebook Ads Manager Custom Audiences
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        {steps.map((step) => (
          <div key={step.number} className="glass-card p-6">
            <div className="flex gap-4">
              <div className="shrink-0">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#1877F2] to-[#0d5bbd] flex items-center justify-center">
                  <span className="text-white font-bold">{step.number}</span>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{step.description}</p>
                <div className="mt-3 px-4 py-3 rounded-lg bg-primary-500/5 border border-primary-500/10">
                  <p className="text-xs text-primary-300">
                    <span className="font-medium">Tip:</span> {step.tip}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Data Mapping Reference */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Data Field Mapping Reference</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-xs font-medium text-white/40 uppercase py-2">SocyBase Field</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase py-2">FB Ads Format</th>
                <th className="text-left text-xs font-medium text-white/40 uppercase py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white/60">
              <tr><td className="py-2">First Name</td><td>fn</td><td>Lowercase</td></tr>
              <tr><td className="py-2">Last Name</td><td>ln</td><td>Lowercase</td></tr>
              <tr><td className="py-2">Gender</td><td>gender</td><td>m or f</td></tr>
              <tr><td className="py-2">Birthday</td><td>dob</td><td>MMDDYYYY format</td></tr>
              <tr><td className="py-2">Location</td><td>ct (city)</td><td>Lowercase</td></tr>
              <tr><td className="py-2">Email</td><td>email</td><td>Not available from FB scraping</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
