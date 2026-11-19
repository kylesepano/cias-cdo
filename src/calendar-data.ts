import { useQuery } from '@tanstack/react-query'
import { db,unwrap } from './data'
import type { Category, EventRow, ExceptionRow } from './recurrence'

export const useCategories = () => useQuery({
  queryKey:['event_categories'],
  queryFn:() => unwrap<Category[]>(db.from('event_categories').select('*').order('sort_order')),
})

export async function pages<T>(fetchPage:(start:number,end:number) => PromiseLike<{data:unknown;error:{message:string}|null}>) {
  const result:T[] = []
  for (let start=0; ; start+=500) {
    const rows = await unwrap(fetchPage(start,start+499)) as T[]
    result.push(...rows)
    if (rows.length<500) return result
  }
}

export const useEvents = (start:string,end:string) => useQuery({
  queryKey:['calendar_events',start,end],
  queryFn:() => pages<EventRow>((a,b) => db.from('calendar_events').select('*')
    .or('rrule.not.is.null,and(starts_at.lt.'+end+',or(starts_at.gte.'+start+',ends_at.gt.'+start+'))').order('id').range(a,b)),
})

export const useExceptions = () => useQuery({
  queryKey:['event_exceptions'],
  queryFn:() => pages<ExceptionRow>((a,b) => db.from('event_exceptions').select('*').order('event_id').order('occurrence_at').range(a,b)),
})

