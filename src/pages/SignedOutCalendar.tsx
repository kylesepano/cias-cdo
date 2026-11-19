import { Clock3 } from 'lucide-react'
import { useState } from 'react'
import { day, ZONE } from '../data'
import { expandEvents, type EventRow, type Occurrence } from '../recurrence'
import { CalendarBoard, initialCalendarRange } from '../ui/CalendarBoard'
import { Dialog } from '../ui/controls'

// Keep the signed-out starter schedule independent of staff calendar records.
const starterEvents:EventRow[] = [
  {id:'wellness',title:'Wellness Break',starts_at:'2026-01-02T16:00:00+08:00',ends_at:null,rrule:'FREQ=WEEKLY;BYDAY=FR'},
  {id:'retreat',title:'Flag Retreat',starts_at:'2026-01-02T16:50:00+08:00',ends_at:null,rrule:'FREQ=WEEKLY;BYDAY=FR'},
  {id:'cleanup',title:'Office Clean-up Drive',starts_at:'2026-01-30T06:00:00+08:00',ends_at:'2026-01-30T08:00:00+08:00',rrule:'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'},
].map(event => ({
  ...event, description:'',location:'',meeting_url:null,category_id:'activity',all_day:false,
  timezone:ZONE,visibility:'office',engagement_id:null,owner_id:null,managed_leave:false,
}))
const colors:Record<string,string> = {wellness:'#08776a',retreat:'#326ba3',cleanup:'#8a631d'}

export default function SignedOutCalendar() {
  const [range,setRange] = useState(initialCalendarRange)
  const [selected,setSelected] = useState<Occurrence|null>(null)

  return <>
    <CalendarBoard initialView="dayGridMonth" items={expandEvents(starterEvents,[],...range)}
      onRangeChange={setRange} onSelect={setSelected} colorFor={item => colors[item.event.id]}/>
    {selected && <Dialog title={selected.title} close={() => setSelected(null)}>
      <p className="inline"><Clock3 size={17}/>{day(selected.start).toFormat('EEEE, MMMM d, yyyy · h:mm a')}
        {selected.end && ' – '+day(selected.end).toFormat('h:mm a')}</p>
    </Dialog>}
  </>
}
