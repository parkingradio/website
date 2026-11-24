import { calendarEvents } from './events.js'
import { FeedReadError } from './fetch.js'
import type { ParseResult, ToParse } from './parse.js'

// The process that goes through a feed's text (see parse.ts): it's sent the text, sends back its events, or why the read
// fails, and ends. Any other error is sent back with only its type, since its message could quote the text.

process.once('message', ({ text, from, to }: ToParse) => {
  let result: ParseResult
  try {
    result = { read: calendarEvents(text, { from, to }) }
  } catch (error) {
    if (error instanceof FeedReadError) result = { failed: { status: error.status, message: error.message } }
    else result = { unexpected: error instanceof Error ? error.name : typeof error }
  }
  process.send!(result, () => process.disconnect!())
})
