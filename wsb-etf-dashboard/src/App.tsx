import PriceChart from './components/PriceChart'
import PortfolioInsight from './components/PortfolioInsight'
import About from './components/About'

function App() {
  return (
    <div className="relative flex min-h-screen flex-col text-foreground">
      {/* ── Hero header ──────────────────────────────────────────── */}
      <header className="relative px-8 pb-6 pt-12 max-md:px-5 max-md:pt-10">
        <h1 className="animate-design-in design-delay-1 font-display text-[clamp(2.5rem,6vw,3.75rem)] leading-[1] tracking-[-0.04em] text-white" style={{ fontWeight: 800 }}>
          WSB <span className="text-[#4ade80]">ETF</span>
        </h1>
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
  )
}

export default App
