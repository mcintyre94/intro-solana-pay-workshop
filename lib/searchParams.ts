import { ParsedUrlQuery } from 'querystring'

// Read the URL query (which includes our chosen products)
export function makeSearchParams(query: ParsedUrlQuery) {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      if (Array.isArray(value)) {
        for (const v of value) {
          searchParams.append(key, v)
        }
      } else {
        searchParams.append(key, value)
      }
    }
  }
  return searchParams
}
