import { PageHeader } from "@/components/kit";

const UPDATED = "September 30, 2026";

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "What we collect",
    p: [
      "Account: your email address and name, used to sign you in (via Supabase Auth or Sign in with Apple).",
      "Training profile: sports, goal races, availability, experience level, units, and thresholds you enter (FTP, paces, heart rates, weight).",
      "Workouts: if you connect Strava, we import your swim, bike and run activities — date, duration, distance, pace/speed, heart rate, power, cadence, elevation, laps and time-series streams — plus anything you log manually.",
      "Coach conversations: messages you send to the in-app coach and its replies.",
      "Health notes you choose to log (injury, illness, fatigue) so training can adapt.",
      "We do not collect your precise location outside of what your activity data contains, contacts, photos, or payment information.",
    ],
  },
  {
    h: "How we use it",
    p: [
      "To calculate your training load, fitness, zones and thresholds, build and adapt your training plan, and generate structured workout files for your devices.",
      "AI coaching: to answer your questions and write post-workout notes, relevant parts of your training data and messages are sent to Anthropic's Claude API for processing. Anthropic processes this data to provide the service and does not use API data to train its models.",
      "We do not sell your data, show ads, or share your data with anyone except the service providers needed to run Vista (Supabase for database/auth hosting, Anthropic for AI, Strava for importing activities you authorize).",
    ],
  },
  {
    h: "Strava",
    p: [
      "Connecting Strava is optional. We only read activities you authorize, and you can disconnect at any time in Profile, which revokes Vista's access. Data from Strava is only shown to you.",
    ],
  },
  {
    h: "Your control",
    p: [
      "Edit or delete any activity, workout or health note in the app.",
      "Delete your account in Profile → Delete account. This permanently removes your profile, activities, plans, thresholds, coach conversations and integrations, and revokes Strava access.",
    ],
  },
  {
    h: "Security & retention",
    p: [
      "Data is encrypted in transit (TLS) and stored in a managed Postgres database with row-level access controls. We keep your data until you delete it or your account.",
    ],
  },
  {
    h: "Health disclaimer",
    p: [
      "Vista provides training guidance, not medical advice. Consult a qualified professional before starting a training program or if you have pain, illness, or a medical condition.",
    ],
  },
  {
    h: "Children",
    p: ["Vista is not directed to children under 13, and we do not knowingly collect their data."],
  },
  {
    h: "Contact",
    p: ["Questions or requests: privacy@vistarunning.app"],
  },
];

export default function PrivacyPage() {
  return (
    <div className="page">
      <PageHeader back title="Privacy Policy" subtitle={`Last updated ${UPDATED}`} />
      <div className="space-y-5 pb-6">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="mb-1.5 text-[16px] font-semibold text-ink-1">{s.h}</h2>
            {s.p.map((t, i) => (
              <p key={i} className="mb-2 text-[14px] leading-relaxed text-ink-2">
                {t}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
