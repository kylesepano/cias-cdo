import FullCalendar from '@fullcalendar/react'
import dayGrid from '@fullcalendar/daygrid'
import timeGrid from '@fullcalendar/timegrid'
import list from '@fullcalendar/list'
import luxon from '@fullcalendar/luxon3'
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { day, now, useMedia, ZONE } from '../data'
import type { Occurrence } from '../recurrence'
import { Button, Card } from './controls'

const views = [['dayGridMonth','Month'],['timeGridWeek','Week'],['timeGridDay','Day'],['listMonth','List']]
const plugins = [dayGrid,timeGrid,list,luxon]
export type CalendarRange = [string,string]

export function initialCalendarRange(): CalendarRange {
  const today = now()
  return [today.startOf('month').minus({days:7}).toUTC().toISO()!,today.endOf('month').plus({days:7}).toUTC().toISO()!]
}

function eventsOnDate(items:Occurrence[],date:string) {
  const start=day(date).startOf('day')
  const from=start.toMillis(),to=start.plus({days:1}).toMillis()
  return items.filter(item=>{
    const time=Date.parse(item.start)
    return time<to && (item.end ? Date.parse(item.end)>from : time>=from)
  })
}

function eventTime(item:Occurrence,date:string) {
  if (item.allDay) return 'All day'
  const start=day(item.start),end=item.end ? day(item.end) : null
  if (start.toISODate()!==date) {
    return end?.toISODate()===date ? 'Until '+end.toFormat('h:mm a') : 'Continues'
  }
  const time=start.toFormat('h:mm a')
  return end?.toISODate()===date ? time+' – '+end.toFormat('h:mm a') : time
}

export function CalendarBoard({items,onRangeChange,onSelect,colorFor,initialView,filters,children}:{
  items:Occurrence[]
  onRangeChange:(range:CalendarRange)=>void
  onSelect:(item:Occurrence)=>void
  colorFor:(item:Occurrence)=>string|undefined
  initialView?:string
  filters?:ReactNode
  children?:ReactNode
}) {
  const calendar = useRef<FullCalendar>(null)
  const mobile = useMedia('(max-width: 650px)')
  const [heading,setHeading] = useState(now().toFormat('MMMM yyyy'))
  const [view,setView] = useState(initialView ?? 'dayGridMonth')
  const [showRecurring,setShowRecurring] = useState(true)
  const [month,setMonth] = useState({start:now().startOf('month').toISODate()!,picked:null as string|null})
  const visibleItems = showRecurring ? items : items.filter(item => !item.event.rrule)
  const compactMonth=mobile && view==='dayGridMonth'
  const week=view==='timeGridWeek' || view==='listWeek'
  const today=now().toISODate()!
  const selectedDate=month.picked ?? (today.startsWith(month.start.slice(0,7)) ? today : month.start)
  const agendaItems=compactMonth ? eventsOnDate(visibleItems,selectedDate) : []
  const color=(item:Occurrence)=>colorFor(item) || '#087d74'

  useEffect(()=>{
    if (!week) return
    const next=mobile ? 'listWeek' : 'timeGridWeek'
    if (view!==next) calendar.current?.getApi().changeView(next)
  },[mobile,view,week])

  return <Card className={'calendar-card'+(compactMonth ? ' calendar-compact' : '')}>
    <div className="calendar-toolbar">
      <div className="actions">
        <Button size="icon" aria-label="Previous period" onClick={() => calendar.current?.getApi().prev()}><ChevronLeft size={18}/></Button>
        <Button size="icon" aria-label="Next period" onClick={() => calendar.current?.getApi().next()}><ChevronRight size={18}/></Button>
        <Button size="small" onClick={() => {
          setMonth(current=>({...current,picked:null}))
          calendar.current?.getApi().today()
        }}>Today</Button>
        <h2 aria-live="polite">{heading}</h2>
      </div>
      <div className="segmented" role="group" aria-label="Calendar view">{views.map(([id,label]) => <button key={id} type="button"
        aria-pressed={view===id || id==='timeGridWeek' && week}
        onClick={() => calendar.current?.getApi().changeView(mobile && id==='timeGridWeek' ? 'listWeek' : id)}>{label}</button>)}</div>
    </div>
    <div className="calendar-filters">
      {filters}
      <span className="muted"><Clock3 size={14}/> Philippine time</span>
      <label className="check calendar-recurring">
        <input type="checkbox" checked={showRecurring} onChange={event => setShowRecurring(event.target.checked)}/>
        Show recurring events
      </label>
    </div>
    {children}
    <FullCalendar ref={calendar} plugins={plugins} initialView={view} timeZone={ZONE}
      headerToolbar={false} height="auto" firstDay={1} scrollTime="07:00:00"
      noEventsContent="No events in this period." eventTimeFormat={{hour:'numeric',minute:'2-digit',meridiem:'short'}}
      navLinks={compactMonth}
      navLinkDayClick={date=>{
        const picked=day(date.toISOString()).toISODate()!
        setMonth(current=>({...current,picked}))
      }}
      dayHeaderFormat={compactMonth ? {weekday:'narrow'} : undefined}
      dayCellContent={compactMonth ? ({date})=>{
        const dateTime=day(date.toISOString())
        const iso=dateTime.toISODate()!
        const entries=eventsOnDate(visibleItems,iso)
        const indicatorCount=entries.length>3 ? 2 : entries.length
        return <span className="calendar-date-content">
          <span className="sr-only">{dateTime.toFormat('MMMM d, yyyy')}, {entries.length} {entries.length===1 ? 'event' : 'events'}</span>
          <span aria-hidden="true" className={'calendar-date-number'+(iso===selectedDate ? ' selected' : '')}>{dateTime.day}</span>
          <span aria-hidden="true" className="calendar-date-indicators">
            {entries.slice(0,indicatorCount).map(item=><i key={item.id} style={{backgroundColor:color(item)}}/>)}
            {entries.length>indicatorCount && <span>+{entries.length-indicatorCount}</span>}
          </span>
        </span>
      } : undefined}
      datesSet={range => {
        onRangeChange([range.start.toISOString(),range.end.toISOString()])
        setHeading(range.view.title)
        setView(range.view.type)
        if (range.view.type==='dayGridMonth') {
          const start=day(range.view.currentStart.toISOString()).toISODate()!
          setMonth(current=>current.start===start ? current : {start,picked:null})
        }
      }}
      events={compactMonth ? [] : visibleItems.map(item => ({id:item.id,title:item.title,start:item.allDay ? day(item.start).toISODate()! : item.start,
        end:item.allDay && item.end ? day(item.end).toISODate()! : item.end || undefined,allDay:item.allDay,interactive:true,
        color:color(item)}))}
      eventClick={info => {
        const item = visibleItems.find(occurrence => occurrence.id===info.event.id)
        if (item) onSelect(item)
      }}
    />
    {compactMonth && <section className="calendar-day-agenda" aria-label="Selected day agenda">
      <h3 aria-live="polite">{day(selectedDate).toFormat('EEEE, MMMM d')}</h3>
      {agendaItems.length ? <ul>
        {agendaItems.map(item=><li key={item.id}>
          <button type="button" className="calendar-agenda-event" onClick={()=>onSelect(item)}>
            <span aria-hidden="true" style={{backgroundColor:color(item)}}/>
            <span><strong>{item.title}</strong><small>{eventTime(item,selectedDate)}</small></span>
          </button>
        </li>)}
      </ul> : <p className="muted">No events on this date.</p>}
    </section>}
  </Card>
}
