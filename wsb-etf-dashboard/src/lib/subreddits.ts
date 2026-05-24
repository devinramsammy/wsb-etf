export const DEFAULT_SUBREDDIT = 'wallstreetbets'

export const SUBREDDITS = [
  { id: 'wallstreetbets', label: 'WSB', name: 'r/wallstreetbets' },
  { id: 'investing', label: 'Investing', name: 'r/investing' },
  { id: 'smallstreetbets', label: 'SmallStreetBets', name: 'r/smallstreetbets' },
  { id: 'stocks', label: 'Stocks', name: 'r/stocks' },
  { id: 'stockmarket', label: 'Stock Market', name: 'r/StockMarket' },
  { id: 'bogleheads', label: 'Bogleheads', name: 'r/Bogleheads' },
] as const

export type SubredditId = (typeof SUBREDDITS)[number]['id']

export function getSubredditConfig(id: SubredditId) {
  return SUBREDDITS.find((s) => s.id === id)!
}

export function getEtfLabel(id: SubredditId): string {
  return `${getSubredditConfig(id).label} ETF`
}
