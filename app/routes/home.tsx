import type { Route } from "./+types/home";
import { useState } from "react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AYSO Game Day" },
    { name: "description", content: "Plan AYSO games, subs, and rotations in minutes. Create fair play rotations, track sit-outs, and keep everyone aligned." },
  ];
}

export default function Home() {
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const toggleFaq = (id: string) => {
    setOpenFaq(openFaq === id ? null : id);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
      {/* Top nav */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-50">
        <nav className="container mx-auto px-4 flex items-center justify-between h-14">
          <a href="#" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--accent)] text-white text-xs">AY</span>
            <span>AYSO Game Day</span>
          </a>
          <ul className="hidden md:flex items-center gap-6">
            <li><a className="text-[var(--muted)] hover:text-[var(--text)] transition" href="#features">Features</a></li>
            <li><a className="text-[var(--muted)] hover:text-[var(--text)] transition" href="#pricing">Pricing</a></li>
            <li><a className="text-[var(--muted)] hover:text-[var(--text)] transition" href="#faq">FAQ</a></li>
          </ul>
          <div className="flex items-center gap-2">
            <a className="hidden sm:inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition" href="/user/login">Sign In</a>
            <a className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0" href="/user/signup">Get Started</a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="py-16">
        <div className="container mx-auto px-4 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex rounded-full px-3 py-1 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
              Built for coaches, schedulers & team parents
            </span>
            <h1 className="mt-4 text-4xl md:text-5xl font-bold leading-tight">
              Plan AYSO games, subs, and rotations in minutes.
            </h1>
            <p className="mt-4 text-lg text-[var(--muted)]">
              Create fair play rotations, track sit-outs, and keep everyone aligned—before you even hit the field.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/user/signup" className="inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0">
                Start Free
              </a>
              <a href="#features" className="inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition hover:-translate-y-0.5 active:translate-y-0">
                See Features
              </a>
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--accent)] text-[var(--accent)] bg-[var(--bg)]">
                AYSO-friendly
              </span>
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                U8–U19
              </span>
            </div>
            <p className="text-sm text-[var(--muted)] mt-3">No credit card required.</p>
          </div>

          {/* Planner preview card */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Next Match</div>
                <span className="rounded-full px-3 py-1 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                  Sat 9:00 AM
                </span>
              </div>
              <div className="border-t border-[var(--border)] my-4"></div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-sm">
                  <div className="p-5">
                    <div className="text-sm text-[var(--muted)]">Opponents</div>
                    <div className="text-lg font-semibold text-[var(--text)]">Rockets</div>
                  </div>
                </div>
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-sm">
                  <div className="p-5">
                    <div className="text-sm text-[var(--muted)]">Field</div>
                    <div className="text-lg font-semibold text-[var(--text)]">GH-3</div>
                  </div>
                </div>
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-sm">
                  <div className="p-5">
                    <div className="text-sm text-[var(--muted)]">Halves</div>
                    <div className="text-lg font-semibold text-[var(--text)]">2 × 25m</div>
                  </div>
                </div>
              </div>
              <div className="border-t border-[var(--border)] my-4"></div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
                  <div className="p-5">
                    <div className="text-sm text-[var(--muted)] mb-2">Starting 9</div>
                    <ul className="space-y-1">
                      <li className="flex justify-between"><span>GK</span><span className="font-medium">Mack</span></li>
                      <li className="flex justify-between"><span>CB</span><span className="font-medium">Charlie</span></li>
                      <li className="flex justify-between"><span>RB</span><span className="font-medium">Gabriel</span></li>
                      <li className="flex justify-between"><span>LB</span><span className="font-medium">Nihit</span></li>
                      <li className="flex justify-between"><span>CM</span><span className="font-medium">Flip</span></li>
                      <li className="flex justify-between"><span>RW</span><span className="font-medium">Ricky</span></li>
                      <li className="flex justify-between"><span>LW</span><span className="font-medium">Andrew</span></li>
                      <li className="flex justify-between"><span>ST</span><span className="font-medium">Emmet</span></li>
                      <li className="flex justify-between"><span>ST</span><span className="font-medium">Kanai</span></li>
                    </ul>
                  </div>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
                  <div className="p-5">
                    <div className="text-sm text-[var(--muted)] mb-2">Sit-outs (per quarter)</div>
                    <div className="grid grid-cols-2 gap-2">
                      <span className="rounded-full px-3 py-1 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">Q1: Dane</span>
                      <span className="rounded-full px-3 py-1 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">Q2: Nihit</span>
                      <span className="rounded-full px-3 py-1 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">Q3: Charlie</span>
                      <span className="rounded-full px-3 py-1 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">Q4: Gabriel</span>
                    </div>
                    <button className="mt-3 w-full inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--primary)] bg-transparent text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition hover:-translate-y-0.5 active:translate-y-0">
                      Auto-balance
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-[var(--muted)]">Compliant with AYSO playtime rules</div>
                <button className="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0">
                  Export to PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="py-8 bg-[var(--bg)] border-y border-[var(--border)]">
        <div className="container mx-auto px-4 flex flex-wrap items-center justify-center gap-6 text-[var(--muted)] text-sm">
          <span>Trusted by <strong className="text-[var(--text)]">200+ coaches</strong></span>
          <span className="hidden sm:inline">•</span>
          <span>Works for <strong className="text-[var(--text)]">7v7, 9v9 & 11v11</strong></span>
          <span className="hidden sm:inline">•</span>
          <span>Sync with <strong className="text-[var(--text)]">Google Calendar</strong></span>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold">What you'll get</h2>
            <p className="mt-2 text-lg text-[var(--muted)]">
              Opinionated tools that feel familiar if you've used Bootstrap-era dashboards—clean, fast, predictable.
            </p>
          </div>

          <div className="mt-8 grid md:grid-cols-3 gap-6">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 inline-flex items-center justify-center rounded bg-[var(--primary)] text-white">1</span>
                  <div className="text-lg font-semibold text-[var(--text)]">Fair Rotation Engine</div>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Auto-generate quarter rotations that respect mandatory sit-outs and keep positions covered.
                </p>
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 inline-flex items-center justify-center rounded bg-[var(--success)] text-white">2</span>
                  <div className="text-lg font-semibold text-[var(--text)]">Role-based Templates</div>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Preset lineups for 7v7/9v9/11v11 with anchor roles for your key players.
                </p>
              </div>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
              <div className="p-5">
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 inline-flex items-center justify-center rounded bg-[var(--warning)] text-white">3</span>
                  <div className="text-lg font-semibold text-[var(--text)]">Shareable Game Sheets</div>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  Distribute clean PDFs to assistants and parents. No guessing on game day.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-16 bg-[var(--bg)] border-y border-[var(--border)]">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold">Simple pricing</h2>
            <p className="mt-2 text-lg text-[var(--muted)]">Start free. Upgrade when your season kicks off.</p>
          </div>

          <div className="mt-8 grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
              <div className="p-5">
                <div className="text-lg font-semibold text-[var(--text)]">Free</div>
                <p className="text-sm text-[var(--muted)]">Plan a single team.</p>
                <div className="mt-3 text-4xl font-bold text-[var(--text)]">$0</div>
                <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
                  <li>• 1 Team</li>
                  <li>• 10 Games</li>
                  <li>• PDF Export</li>
                </ul>
                <button className="w-full mt-4 inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0">
                  Get Started
                </button>
              </div>
            </div>

            {/* Coach */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-md ring-1 ring-[var(--primary)]/10">
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold text-[var(--text)]">Coach</div>
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--accent)] text-[var(--accent)] bg-[var(--bg)]">
                    Popular
                  </span>
                </div>
                <p className="text-sm text-[var(--muted)]">Everything for one coach, all season.</p>
                <div className="mt-3 text-4xl font-bold text-[var(--text)]">
                  $9<span className="text-base text-[var(--muted)] font-normal">/mo</span>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
                  <li>• 3 Teams</li>
                  <li>• Unlimited Games</li>
                  <li>• Rotation Engine</li>
                  <li>• Calendar Sync</li>
                </ul>
                <button className="w-full mt-4 inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0">
                  Try Coach
                </button>
              </div>
            </div>

            {/* Club */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
              <div className="p-5">
                <div className="text-lg font-semibold text-[var(--text)]">Club</div>
                <p className="text-sm text-[var(--muted)]">For age-group coordinators and clubs.</p>
                <div className="mt-3 text-4xl font-bold text-[var(--text)]">
                  $39<span className="text-base text-[var(--muted)] font-normal">/mo</span>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
                  <li>• Unlimited Teams</li>
                  <li>• Bulk Imports</li>
                  <li>• Role Permissions</li>
                  <li>• Priority Support</li>
                </ul>
                <button className="w-full mt-4 inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0">
                  Contact Sales
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold">Frequently asked</h2>
            <p className="mt-2 text-lg text-[var(--muted)]">Quick answers about fairness, positions, and exports.</p>
          </div>

          <div className="mt-6 border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
            <div className="bg-[var(--surface)]">
              <button 
                className="w-full text-left px-5 py-4 font-medium text-[var(--text)] hover:bg-[var(--bg)]"
                onClick={() => toggleFaq('q1')}
              >
                How do sit-outs work?
              </button>
              {openFaq === 'q1' && (
                <div className="px-5 pb-5 text-[var(--muted)]">
                  Mark required sit-outs and the engine spreads them evenly across quarters while keeping core positions covered.
                </div>
              )}
            </div>
            <div className="bg-[var(--surface)]">
              <button 
                className="w-full text-left px-5 py-4 font-medium text-[var(--text)] hover:bg-[var(--bg)]"
                onClick={() => toggleFaq('q2')}
              >
                Can I anchor players to positions?
              </button>
              {openFaq === 'q2' && (
                <div className="px-5 pb-5 text-[var(--muted)]">
                  Yes. Lock players to positions (e.g., GK/CB) and the generator rotates everyone around those anchors.
                </div>
              )}
            </div>
            <div className="bg-[var(--surface)]">
              <button 
                className="w-full text-left px-5 py-4 font-medium text-[var(--text)] hover:bg-[var(--bg)]"
                onClick={() => toggleFaq('q3')}
              >
                Do you support 7v7, 9v9 and 11v11?
              </button>
              {openFaq === 'q3' && (
                <div className="px-5 pb-5 text-[var(--muted)]">
                  All three. Choose your format and templates adjust accordingly.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section id="cta" className="py-16 bg-[var(--bg)] border-y border-[var(--border)]">
        <div className="container mx-auto px-4 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h3 className="text-2xl font-bold">Ready to plan your next match?</h3>
            <p className="mt-2 text-lg text-[var(--muted)]">
              Start with your roster and next game time. You'll have a clean plan in under five minutes.
            </p>
          </div>
          <form className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
            <div className="p-5 grid gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input 
                  type="email" 
                  className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent" 
                  placeholder="coach@club.org" 
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Team Name</label>
                  <input 
                    className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent" 
                    placeholder="U12 Spartans" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Format</label>
                  <select className="w-full rounded border border-[var(--border)] px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent">
                    <option>7v7</option>
                    <option>9v9</option>
                    <option>11v11</option>
                  </select>
                </div>
              </div>
              <button className="inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0">
                Create Free Account
              </button>
              <p className="text-xs text-[var(--muted)]">By continuing you agree to our terms.</p>
            </div>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10">
        <div className="container mx-auto px-4 grid md:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="font-semibold">AYSO Game Day</div>
            <p className="text-[var(--muted)] mt-2">Designed for fairness, clarity, and game-day calm.</p>
          </div>
          <div>
            <div className="font-semibold">Product</div>
            <ul className="mt-2 space-y-1 text-[var(--muted)]">
              <li><a className="hover:text-[var(--text)] transition" href="#features">Features</a></li>
              <li><a className="hover:text-[var(--text)] transition" href="#pricing">Pricing</a></li>
              <li><a className="hover:text-[var(--text)] transition" href="#faq">FAQ</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold">Support</div>
            <ul className="mt-2 space-y-1 text-[var(--muted)]">
              <li><a className="hover:text-[var(--text)] transition" href="#">Help Center</a></li>
              <li><a className="hover:text-[var(--text)] transition" href="#">Status</a></li>
              <li><a className="hover:text-[var(--text)] transition" href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-4 mt-8 text-xs text-[var(--muted)]">
          © {new Date().getFullYear()} AYSO Game Day
        </div>
      </footer>
    </div>
  );
}