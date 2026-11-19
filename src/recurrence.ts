import { DateTime } from 'luxon'
import { RRule } from 'rrule'

const ZONE = 'Asia/Manila'
export interface Category {id:string;name:string;description:string;color:string;icon:string;sort_order:number}
export interface EventRow {
  id:string; title:string; description:string; location:string; meeting_url:string|null; category_id:string
  starts_at:string; ends_at:string|null; all_day:boolean; timezone:string; rrule:string|null
  visibility:string; engagement_id:string|null; owner_id:string|null; managed_leave:boolean
}
export interface ExceptionRow {
  event_id:string; occurrence_at:string; cancelled:boolean; title:string|null; starts_at:string|null; ends_at:string|null
}
export interface Occurrence {id:string; original:string; title:string; start:string; end:string|null; allDay:boolean; event:EventRow}
const canonical = (value:string) => new Date(value).toISOString()

export function expandEvents(events: EventRow[], exceptions: ExceptionRow[], from: string, to: string): Occurrence[] {
  const minimum = Date.parse(from), maximum = Date.parse(to)
  if (!(maximum > minimum) || maximum-minimum > 1000*60*60*24*95) return []
  const result: Occurrence[] = []
  const lookup = new Map<string,ExceptionRow[]>()
  for (const exception of exceptions) {
    const group = lookup.get(exception.event_id) || []
    group.push(exception)
    lookup.set(exception.event_id,group)
  }
  for (const event of events) {
    const origin = DateTime.fromISO(event.starts_at,{zone:ZONE})
    if (!origin.isValid) continue
    const duration = event.ends_at ? Date.parse(event.ends_at)-origin.toMillis() : 0
    const overrides = new Map((lookup.get(event.id) || []).map(row => [canonical(row.occurrence_at),row]))
    const add = (original: string, override?: ExceptionRow) => {
      if (override?.cancelled) return
      const start = override?.starts_at ? canonical(override.starts_at) : original
      const timestamp = Date.parse(start)
      const end = override ? (override.ends_at ? canonical(override.ends_at) : null) :
        (duration > 0 ? new Date(timestamp+duration).toISOString() : null)
      if (timestamp>=maximum || (end ? Date.parse(end)<=minimum : timestamp<minimum)) return
      result.push({id:event.id+'@'+original,original,title:override?.title || event.title,start,end,allDay:event.all_day,event})
    }
    if (!event.rrule) {
      add(origin.toUTC().toISO()!)
      continue
    }
    try {
      const allowed = /^(?:FREQ=(?:DAILY|WEEKLY|MONTHLY|YEARLY))(?:;(?:INTERVAL=\d+|BYDAY=(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*|BYSETPOS=-?[1-5]|BYMONTHDAY=\d{1,2}|BYMONTH=\d{1,2}|COUNT=\d+|UNTIL=\d{8}T\d{6}Z))*$/
      if (!allowed.test(event.rrule)) continue
      const wallDate = (instant: DateTime) => instant.setZone(ZONE).setZone('UTC',{keepLocalTime:true}).toJSDate()
      const options = RRule.parseString(event.rrule)
      if (options.interval !== undefined && (options.interval < 1 || options.interval > 365)) continue
      const recurrence = new RRule({...options,dtstart:wallDate(origin),until:options.until ? wallDate(DateTime.fromJSDate(options.until)) : null})
      const start = wallDate(DateTime.fromMillis(minimum-Math.max(duration,0)))
      const end = wallDate(DateTime.fromMillis(maximum))
      for (const wall of recurrence.between(start,end,true)) {
        const original = DateTime.fromJSDate(wall,{zone:'UTC'}).setZone(ZONE,{keepLocalTime:true}).toUTC().toISO()!
        add(original,overrides.get(original))
        overrides.delete(original)
      }
      for (const [original,override] of overrides) {
        if (!override.starts_at || override.cancelled) continue
        const movedStart = Date.parse(override.starts_at)
        if (movedStart>=maximum || (override.ends_at ? Date.parse(override.ends_at)<=minimum : movedStart<minimum)) continue
        const originalWall = wallDate(DateTime.fromISO(original))
        if (recurrence.before(originalWall,true)?.getTime()===originalWall.getTime()) add(original,override)
      }
    } catch {
      // Ignore an invalid imported rule so one record cannot prevent rendering the calendar.
    }
  }
  return result.sort((a,b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

export function birthdayEvents(people: {id:string;full_name:string;birth_month?:number;birth_day?:number}[]): EventRow[] {
  return people.flatMap(person => {
    if (!person.birth_month || !person.birth_day) return []
    const first = DateTime.fromObject({year:2000,month:person.birth_month,day:person.birth_day},{zone:ZONE})
    if (!first.isValid) return []
    return [{id:'birthday-'+person.id,title:person.full_name+' · Birthday',description:'',location:'',meeting_url:null,
      category_id:'birthday',starts_at:first.toISO()!,ends_at:first.plus({days:1}).toISO(),all_day:true,
      timezone:ZONE,rrule:'FREQ=YEARLY;BYMONTH='+person.birth_month+';BYMONTHDAY='+person.birth_day,
      visibility:'office',engagement_id:null,owner_id:null,managed_leave:false}]
  })
}
export const weekdays = ['MO','TU','WE','TH','FR','SA','SU']
export const weekdayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

export function buildRule(data: Record<string,string>, days: string[]) {
  const start = DateTime.fromISO(data.starts,{zone:ZONE})
  if (!start.isValid) throw new Error('Choose a valid start date.')
  const interval = Number(data.interval || 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw new Error('Use an interval between 1 and 365.')
  const kind = data.repeat
  if (!kind || kind === 'never') return null
  const parts = ['FREQ='+ (kind === 'monthly_nth' ? 'MONTHLY' : kind.toUpperCase())]
  if (interval !== 1) parts.push('INTERVAL='+interval)
  if (kind === 'daily' && days.length) parts.push('BYDAY='+days.join(','))
  if (kind === 'weekly') parts.push('BYDAY='+(days.length ? days.join(',') : weekdays[start.weekday-1]))
  if (kind === 'monthly') parts.push('BYMONTHDAY='+(data.monthday || start.day))
  if (kind === 'monthly_nth') parts.push('BYDAY='+(data.weekday || weekdays[start.weekday-1]),'BYSETPOS='+data.position)
  if (kind === 'yearly') {
    const month = Number(data.yearmonth || start.month)
    const day = Number(data.yearday || start.day)
    if (!DateTime.fromObject({year:2000,month,day},{zone:ZONE}).isValid) throw new Error('Choose a valid annual month and day.')
    parts.push('BYMONTH='+month,'BYMONTHDAY='+day)
  }
  if (data.end_type === 'count') {
    const count = Number(data.occurrence_count)
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Enter a count from 1 to 10,000.')
    parts.push('COUNT='+count)
  }
  if (data.end_type === 'date') {
    const end = DateTime.fromISO(data.until,{zone:ZONE})
    if (!end.isValid || end.toISODate()! < start.toISODate()!) throw new Error('Choose a series end date on or after the start.')
    parts.push('UNTIL='+end.endOf('day').toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'"))
  }
  return parts.join(';')
}

