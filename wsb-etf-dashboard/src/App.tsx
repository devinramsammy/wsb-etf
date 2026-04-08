import PriceChart from './components/PriceChart'
import Composition from './components/Composition'
import Changelog from './components/Changelog'

function App() {
  return (
    <div className="relative flex min-h-screen flex-col text-foreground">
      <header className="relative px-8 pb-2 pt-10 max-md:px-4 max-md:pb-1 max-md:pt-8">
        <div
          className="pointer-events-none absolute -left-4 top-6 h-px w-32 bg-gradient-to-r from-primary/80 to-transparent max-md:left-0 max-md:top-5 max-md:w-24"
          aria-hidden
        />
        <p
          className="animate-design-in design-delay-1 font-sans text-[0.65rem] font-semibold uppercase tracking-[0.38em] text-primary"
        >
          Synthetic index
        </p>
        <h1
          className="animate-design-in design-delay-2 mt-3 font-display text-[clamp(2rem,5vw,2.85rem)] font-medium leading-[1.08] tracking-[-0.02em] text-foreground"
        >
          WSB{' '}
          <span className="text-gradient-accent italic" style={{ fontWeight: 550 }}>
            ETF
          </span>
        </h1>
        <p
          className="animate-design-in design-delay-3 mt-3 max-w-xl font-sans text-[0.9375rem] font-normal leading-relaxed text-muted-foreground"
        >
          A synthetic ETF built from r/wallstreetbets sentiment—holdings and price
          history in one view.
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-8 px-8 pb-12 pt-4 max-md:gap-6 max-md:px-4 max-md:pb-10">
        <section className="animate-design-in design-delay-4">
          <PriceChart />
        </section>

        <section className="animate-design-in design-delay-5 grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
          <Composition />
          <Changelog />
        </section>
      </main>
    </div>
  )
}

export default App
