import { useState } from 'react'
import PriceChart from './components/PriceChart'
import PortfolioInsight from './components/PortfolioInsight'
import About from './components/About'
import { SubredditContext } from './context/SubredditContext'
import { SUBREDDITS, DEFAULT_SUBREDDIT, getSubredditConfig } from './lib/subreddits'
import type { SubredditId } from './lib/subreddits'
import { cn } from '@/lib/utils'

function App() {
  const [subreddit, setSubreddit] = useState<SubredditId>(DEFAULT_SUBREDDIT)
  const active = getSubredditConfig(subreddit)

  return (
    <SubredditContext.Provider value={{ subreddit, setSubreddit }}>
      <div className="relative flex min-h-screen flex-col text-foreground">
        <header className="relative px-8 pb-6 pt-12 max-md:px-5 max-md:pt-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="animate-design-in design-delay-1 font-display text-[clamp(2.5rem,6vw,3.75rem)] leading-[1] tracking-[-0.04em] text-white" style={{ fontWeight: 800 }}>
              {active.label} <span className="text-[#4ade80]">ETF</span>
            </h1>

            <div className="animate-design-in design-delay-2 flex flex-wrap gap-2">
              {SUBREDDITS.map((item) => {
                const selected = item.id === subreddit
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSubreddit(item.id)}
                    className={cn(
                      'rounded-lg border px-3 py-2 font-mono text-[0.72rem] font-semibold tracking-[0.08em] transition-all duration-200',
                      selected
                        ? 'border-[#4ade80]/45 bg-[#4ade80]/[0.12] text-[#bbf7d0] shadow-[0_0_24px_-10px_rgba(74,222,128,0.55)]'
                        : 'border-white/[0.07] bg-black/30 text-slate-500 hover:border-white/12 hover:bg-white/[0.04] hover:text-slate-400',
                    )}
                  >
                    {item.name}
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        <main className="flex flex-1 flex-col gap-5 px-8 pb-16 max-md:gap-4 max-md:px-5 max-md:pb-12">
          <section className="animate-design-in design-delay-4 flex flex-col gap-5 lg:flex-row lg:items-stretch">
            <div className="flex min-h-[280px] flex-1 flex-col self-stretch min-w-0 lg:min-h-0">
              <PriceChart />
            </div>
            <div className="flex shrink-0 flex-col self-stretch lg:w-[min(26rem,100%)]">
              <About />
            </div>
          </section>

          <section className="animate-design-in design-delay-6">
            <PortfolioInsight />
          </section>
        </main>
      </div>
    </SubredditContext.Provider>
  )
}

export default App
