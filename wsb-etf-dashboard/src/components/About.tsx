import { useQuery } from '@tanstack/react-query'
import { fetchChangelogMeta } from '../api/client'
import { useSubreddit } from '../context/SubredditContext'
import { getSubredditConfig } from '@/lib/subreddits'

function About() {
  const { subreddit } = useSubreddit()
  const source = getSubredditConfig(subreddit)

  const { data: changelogMeta } = useQuery({
    queryKey: ['changelog-meta', subreddit],
    queryFn: () => fetchChangelogMeta(subreddit),
  })

  const rebalanceCount = changelogMeta != null ? changelogMeta.dates.length : null

  return (
    <div className="about-card h-full">
      <h2 className="about-title">About</h2>

      <p className="about-desc">
        A synthetic ETF derived from {source.name}. Posts from the subreddit are
        analyzed by{' '}
        <span className="font-mono">gemini-3.1-flash-lite-preview</span>{' '}
        for sentiment per ticker.         Signals are merged with Reddit score-weighted
        sentiment votes, producing a NAV-style price. The pipeline fully rebalances weekly, liquidating the entire prior
        basket at as-of closes and repurchasing the new target weights with the
        proceeds.
      </p>

      <div className="about-details">
        <div className="about-detail-row">
          <span className="about-detail-label">Data Source</span>
          <span className="about-detail-value">{source.name}</span>
        </div>
        <div className="about-detail-row">
          <span className="about-detail-label">Sentiment Model</span>
          <span className="about-detail-value font-mono">gemini-3.1-flash-lite-preview</span>
        </div>
        <div className="about-detail-row">
          <span className="about-detail-label">Rebalance</span>
          <span className="about-detail-value">Weekly full turnover</span>
        </div>
        <div className="about-detail-row">
          <span className="about-detail-label">Weighting</span>
          <span className="about-detail-value">Score-weighted: bull 1, neutral 0.3, bear 0</span>
        </div>
        <div className="about-detail-row">
          <span className="about-detail-label">Rebalance Events</span>
          <span className="about-detail-value">{rebalanceCount ?? '-'}</span>
        </div>
      </div>
    </div>
  )
}

export default About
