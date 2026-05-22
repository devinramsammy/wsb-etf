import { createContext, useContext } from 'react'
import type { SubredditId } from '@/lib/subreddits'

interface SubredditContextValue {
  subreddit: SubredditId
  setSubreddit: (id: SubredditId) => void
}

export const SubredditContext = createContext<SubredditContextValue | null>(null)

export function useSubreddit() {
  const ctx = useContext(SubredditContext)
  if (!ctx) {
    throw new Error('useSubreddit must be used within SubredditProvider')
  }
  return ctx
}
